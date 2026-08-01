# 共同幕布滚动所有权与编排架构（Scroll Ownership Architecture）

> **日期**：2026-08-01（F 类 / 间歇性补记同日）
> **内容类型**：Strategic Architecture + Decision Record
> **生命周期**：implemented，待 Human QA / verify / archive
> **状态**：**代码已入库** `b34fdaead`（`scrollAuthorityMachine` + controller 接入）；OpenSpec `23/26`，仅余 3 项 Human QA
> **最后校准**：2026-08-01 · mossx `0.7.14` · HEAD `26f8065a0c`
> **分析入口**：`docs/analysis/conversation-canvas-structure-2026-07-31.md` §7.3 · `docs/analysis/README.md`
> **触发症状（已确认）**
> - **A**：发送后飞顶 / 跟丢最新
> - **F**：回合结束后滚动条/视口未达真底（实机截图；**间歇复现**）
> **产品立场**：不再对滚动问题做路径级止血；在 **共同幕布（Messages 核）** 做层级权限与编排重构
> **范围**：所有 native CLI + Shared Session 共用的 Messages 滚动/高度生命周期（**与引擎无关**）
> **关联**
> - 结构底稿：`docs/analysis/conversation-canvas-structure-2026-07-31.md`
> - 统一幕布任务：`docs/plans/2026-08-01-unified-conversation-canvas-architecture.md`
> - 既有止血 change：`openspec/changes/fix-messages-scroll-echo-follow-loss`（实现 + 单测闭环；**实机 5.x 未勾**）
> - 近期路径修：`b3cbfaa8` 快流 thrash / settle 吸底偏差

---

## 0. 一句话目标

**单一 Owner 状态机写 `scrollTop`；高度生命周期只能发“几何事件”，不能直接抢滚动权。**

发送、流式、settle、虚拟化翻转、尾窗裁剪、工具卡长高——全部变成 **可审计的 Intent 输入**，由同一套 **Authority Arbiter** 决定：钉底 / 保持中部 / 跳锚 / 拒绝写入。

**贴真底的正确性条件是「动态 maxScrollTop + 几何稳态」，不是「会话长短」或「固定 2.4s 预算」。**

---

## 1. 为什么必须重构（不是再修一条 if）

### 1.1 确认的用户问题

| 编号 | 体感 | 本设计主攻 |
|------|------|------------|
| **A** | 发送后飞顶 / 跟丢最新 | **是** |
| **F** | **回合结束后**离真底（滚动条不在轨底；间歇） | **是（与 A 并列）** |
| B | 内容上移但最新仍在底 | 正常聊天观感；非 bug |
| C | 闪一下再贴底 | 验收指标（闪烁预算），非主因果 |
| D | idle 虚拟化切换闪跳 | 纳入几何生命周期合同 |
| E | 「显示更早」去顶 | 产品预期；保留为独立 Intent |

| | **A 飞顶/跟丢** | **F 结束离真底** |
|--|----------------|------------------|
| 时机 | 多在 **发送瞬间 / 高度塌缩** | 多在 **working 下降沿之后 / settle 后** |
| 体感 | 突然到顶或很上面 | 「明明结束了，滚动条还不在底」 |
| 共同根 | **高度还在变，但 Owner 已经松手或钉错高度** | 同左 |
| 关系 | 同一架构病的两个相位：A = Owner 被误杀/打飞；F = Owner 只钉了某一帧假底或预算先死 | |

**排障注意**：侧栏文件树 scroller 与消息幕布 scroller 相邻，截图易误指。契约与探针 **只认 Messages 容器**。

### 1.1.1 症状 F：回合结束后未达真底

> **用户确认**：对话已结束（非流式），幕布滚动条滑块不在轨道底部；与发送飞顶（A）同属老问题，多次路径级修复后仍复现。

#### F 的 As-Is 机制

```text
isWorking false → turn-settle 钉「当时」maxScrollTop（底₁）
  → 其后仍可能：思考折叠 / full MD / 尾窗回全量 / idle 虚拟化 attach+remeasure
  → settle 预算（SETTLE_REPIN_WINDOW_MS ≈ 2400ms）耗尽
    或 autoScroll 被 nearBottom/echo/wheel 误关
  → 焦点跟随若关闭则不再 live stick
  → 视口停在底₁/底₂；滚动条滑块停在中上段  ← F
```

关键常数/路径（源码）：

| 项 | 值 / 位置 | 问题 |
|----|-----------|------|
| settle 预算 | `SETTLE_REPIN_WINDOW_MS = 2400` | **时间预算 ≠ 几何稳态** |
| follow 宽松阈值 | `SCROLL_THRESHOLD_PX = 120` | 适合「是否继续 follow」，**不适合**「是否贴真底」验收 |
| turn-settle | `beginTurnBoundaryBottomConvergence("turn-settle")` | 只保证边沿当帧附近追底 |
| 焦点跟随 stick | `liveAutoFollow && autoScroll && !userIntent` | 开则可追迟到长高；**关则 F 更重** |
| 虚拟化 | 流式关、idle 可开（≥约 48 行等） | **phase 翻转常落在 settle 之后** |

**真底定义（To-Be）**：`distanceToBottom <= 1px`（设备像素对齐）。
**禁止**用 120px nearBottom 当作回合结束完成态。

#### 为何路径止血消不掉 F

1. 把「贴底」做成 **时间窗**，而不是 **几何稳态 + Owner 模式**。
2. 第一次 pin 使用 **瞬时 max**，不订阅后续单调增长。
3. `nearBottom(120px)` 与「滚动条是否在轨底」产品语义不一致。
4. 虚拟化/估高/尾窗 常在 settle **之后** 才完成最大高度变化。
5. 单测多要求焦点跟随开启；实机关跟随或误杀 armed 时行为不同。

### 1.1.2 间歇性：长短不是本质（用户校准 2026-08-01）

> **观察**：有时 F 不出现；短对话结束也能贴底，长对话有时也正常。
> **结论**：会话长短 **不是** 充要根因；本质是 **竞态组合**。

#### 决策公式（与 message count 无关）

```text
结束 pin 到「当时的底」
        │
        ▼
  结束后是否还有高度变化？  ──否──► 稳贴底（短/长都可能）
        │是
        ▼
  变化落在谁的窗口里？
   ├─ 2.4s settle 内 + autoScroll 仍 true     → 多半追上
   ├─ 焦点跟随开 + 仍在底                     → 预算过了也能追（b3cbfaa8 语义）
   └─ 预算过了且跟随关 / autoScroll 已被误杀 → F
```

**长短不出现在判定式里。** 出现的是：

1. **PostSettleGeometryGrowth?** — 结束后是否还有长高、发生在何时
2. **OwnerAliveAtGrowth?** — forced/stick 是否仍有效
3. **ArmedKilledByNoise?** — echo / wheel / nearBottom 是否误杀 armed

#### 成败真值表

| 结束后迟到长高 | settle 窗内追上 | 焦点跟随仍 stick | 结果 |
|----------------|-----------------|------------------|------|
| 无 | — | — | **稳贴底**（短/长都常见） |
| 有 | 是 | — | **贴底** |
| 有 | 否 | 是且 autoScroll | **贴底** |
| 有 | 否 | 关或 autoScroll 已死 | **F** |
| 有 | 中途被 echo/wheel 误杀 | — | **F / 偶发** |

#### 驱动「有/无」的真实因子（长短仅为弱相关）

| 因子 | 说明 | 与长短关系 |
|------|------|------------|
| **结束后迟到长高** | 思考折叠、staged→full MD、工具卡测高、尾窗回全量、virtual remeasure | 长会话更易触发部分项；**短+重 MD/工具卡**同样触发 |
| **硬时间窗竞态** | settle 2400ms；recheck 100/300/1000/2000；echo grace 350ms；user-intent 500ms | **纯时序**；CPU/WebView 负载一变结果就变 |
| **焦点跟随开/关** | 默认 true，可关；关则窗后不追 | 与长度无关 |
| **armed 误杀** | 触控板惯性上滚；echo 晚于 350ms；nearBottom 瞬时 false | **与长度无关**，主间歇源 |
| **阈值踩线** | 尾窗 ~60、虚拟化 ≥48、render weight | 是「是否发生某几何事件」，不是「越长越坏」 |
| **结束前是否在底** | 一直 follow vs 读过历史 | 用户行为，与长度无关 |

**相关 ≠ 因果**：长短只影响「第一列（迟到长高）」的概率，不单独决定结果。

#### 禁止的错误归因

- ❌ 「长会话 bug / 短会话没问题」作为根因分类
- ❌ 默认把 `SETTLE_REPIN_WINDOW_MS` 加长当修复
- ❌ 只按 `messageCount` 写回归而不打时间线

#### 探针时间线（Phase 0 必打，禁止只记条数）

```text
t=0     working↓  settle pin   H=H0  distance=0  owner=forced
t=800   full-md                H=H1  distance=?  owner=?
t=2100  virtual remeasure      H=H2
t=2500  budget end
t=3100  late grow              H=H3  distance>0  ← F 发生点（若 owner 已死）
```

同一条数、不同负载 → 时间线可完全不同 → **间歇性**。

### 1.2 现状架构病根（As-Is）

当前事实（源码锚点）：

```text
MessagesCore (~1.8k 行)
  ├─ updateAutoScroll          // scroll 事件 → autoScroll / cancel
  ├─ turn boundary layoutEffect // userMessage / working 边沿 → turn-send|settle
  ├─ live-follow useEffect     // scrollKey → requestAutoScroll
  ├─ history-open layoutEffect // 开会话钉底
  ├─ manual expand layoutEffect// scrollTop=0
  └─ ResizeObserver 在 controller 内 // clamp + stick / settle 预算

useMessagesScrollController (~570 行)
  ├─ autoScrollRef
  ├─ stickToBottomIntentRef + deadline
  ├─ activeScrollIntentRef + convergence cancel
  ├─ user-intent lease
  └─ echo fingerprint ring

messagesScrollConvergence  // 多帧追 target
messagesScrollEcho         // 程序化回声 vs 用户滚动
timeline virtualizer       // idle 可开；流式关；initialOffset=scrollTop
live 尾窗 / presentation    // 高度塌缩 / 暴涨的主要几何源
```

**问题不是“没有逻辑”，而是“多层逻辑并行写权”：**

| 层 | 都能影响视口 | 互相知道对方吗？ |
|----|--------------|------------------|
| `autoScrollRef` | 解除/武装跟随 | 部分 |
| `live-follow` | 连续钉底 | 与 boundary 分权但不统一状态机 |
| `turn-send` / `turn-settle` | 强制钉底 + 清 lease | 可覆盖用户位置（产品意图） |
| `history-open` 预算窗 | 迟到测高追底 | 与 stick intent 共用 deadline 语义 |
| echo fingerprint | 豁免 scroll 事件 | 启发式；grace 350ms |
| ResizeObserver | 同步 flush / nudge | 与 rAF coalesce 两套节奏 |
| 尾窗 / 虚拟化 / 估高 | 改 `scrollHeight` | **不经 Owner 声明几何事件** |

结果：同一 **A/F** 症状族，历史上可以来自

1. 高度塌缩 → 浏览器钳位 → **异步 scroll 回声误杀 follow**（偏 A）
2. static↔virtual attach 默认 `initialOffset=0`（偏 A/D）
3. stick 资格绑 `isWorking` → settle 后离底（偏 F；`b3cbfaa8` 已改跟随语义，关跟随仍洞）
4. settle **时间窗**耗尽后仍 remeasure（偏 F；**间歇**）
5. 快流 cancel/restart thrash
6. wheel/echo 误杀 armed 后再长高（偏 F；**与长度无关**）
7. …以及下次新的几何源

每条路径各修一次，**Owner 仍是碎片** → “多次解决仍不根治”。

### 1.3 设计原则（硬约束）

1. **Single Writer**：任意时刻最多一个 **Scroll Owner** 可写 `scrollTop`（含 clamp 补偿）。
2. **Intent 优先于启发式**：产品意图（发送见最新 / 用户上滚 / 跳锚）显式进入状态机，不用“像不像用户滚动”猜到底。
3. **几何与滚动解耦**：尾窗、虚拟化、折叠只能发 `GeometryDelta`，**禁止**直接 `scrollTop = 0/max`。
4. **全 CLI 一核**：Claude/Codex/Grok/Kimi/OpenCode/Shared **同一 Arbiter**；引擎只影响 Geometry 事件频率，不分支 Owner 规则。
5. **可证明**：每个 Owner 转换有 reason code；测试断言 **状态转移**，不只断言最终 `scrollTop` 数字。
6. **禁止第 N 层 guard 默认**：新 bug 默认进状态机缺口，不进 `if (specialCase)`。

---

## 2. 行业专家怎么做（调研摘要）

调研对象：AI 聊天主流库与虚拟列表合同（2026-08 公开文档/源码描述）。
**不直接整库替换**；吸收 **所有权模型** 与 **几何合同**。

### 2.1 对照表

| 方案 | 核心模型 | 对 mossx 的可取之处 | 不足 / 不直接适用 |
|------|----------|---------------------|-------------------|
| **[use-stick-to-bottom](https://github.com/stackblitz-labs/use-stick-to-bottom)**（StackBlitz；Vercel AI Elements `Conversation` 底层） | `scrollRef` + `contentRef`；**ResizeObserver** 驱动 stick；用户上滚取消；**区分用户 scroll 与动画 scroll（无 debounce）**；内容**收缩仍可 stick**；velocity spring（适配流式变高）；**不依赖** Safari 缺失的 `overflow-anchor` | ① 内容与滚动器分离 ② RO 是唯一高度源 ③ 用户取消 vs 程序滚动的清晰边界 ④ shrink 仍 stick（对应尾窗塌缩） | 无虚拟列表合同；无“回合边界强制钉底”产品语义；无 multi-CLI 尾窗 |
| **Vercel AI Elements `Conversation`** | 封装 stick-to-bottom + 离底按钮；`scrollToBottom` 给子组件（发消息时调用） | **发送是显式 API**，不是靠“像不像在底”猜 | 产品壳，非复杂时间线 |
| **react-virtuoso `followOutput`** | 虚拟列表内置 **followOutput**；`atBottomStateChange`；输出增长时跟随 | 虚拟化与 follow **同一坐标系**；避免 “virtualizer 一套、我们一套” | 需评估替换 TanStack Virtual 成本；仍要自研 turn boundary |
| **CSS `overflow-anchor`** | 浏览器对上方内容变高做锚点补偿 | 中部阅读时减少“被顶走” | **Safari / 部分 WebView 弱或无**；不能当唯一正确性；stick-to-bottom 库明确 **不依赖** 它 |
| **assistant-ui 等 AI chat 壳** | 公开叙述强调：用户滚动 / 程序滚动 / stick 判定是核心难点 | 验证问题域共识 | 黑盒，不适合当实现依赖 |
| **经典 chat UX（Slack 类）** | “在底才 follow；上滚出 New messages；发消息 jump to latest” | 与 turn-send **强制见最新** 一致 | 实现各异 |

### 2.2 专家共识（可写成合同）

```text
1. Stick 是「armed 状态」，不是「每次 scroll 事件猜一次」。
2. 用户明确上滚 = 解除 armed；回到底部或显式按钮/发送 = 再武装。
3. 内容变高用 ResizeObserver（或等价布局观测），不要靠 item 列表 diff 猜高度。
4. 程序写入产生的 scroll 事件必须可识别，不能当用户意图（echo / flag / rAF 所有权）。
5. 流式变高用「连续跟踪 target」，忌固定 duration easing（内容还在长时动画已结束）。
6. 虚拟列表若存在，follow 必须在 virtualizer 合同内，禁止外部乱写 scrollTop 与 measure 打架。
7. 内容收缩（尾窗/折叠）必须定义：armed 时仍贴新底，还是保持锚点消息。
```

### 2.3 mossx 与专家模型的差距

| 共识 | mossx 现状 | 重构目标 |
|------|------------|----------|
| 单一 stick armed | `autoScroll` + 多 intent + deadline **三套** | **一个** `ViewportMode` |
| RO 驱动 | 有，但与 scrollKey effect / boundary 并行 | RO 只报 `GeometryDelta`，Arbiter 决策 |
| 用户 vs 程序 scroll | echo 指纹 + lease（复杂、grace 启发式） | **WriteTicket**：只有持票写入才合法；scroll 无票=用户 |
| 流式 spring/连续 target | multi-frame convergence + recheck 定时器 | 保留收敛算法，**挂到 Owner 下**，禁止无主 cancel/restart |
| 虚拟化同坐标系 | idle 开、流式关；handoff 靠 initialOffset | **GeometryPhase** 显式：static↔virtual 必须先 `PreserveAnchor` 再 attach |
| 发送见最新 | turn-send layoutEffect | 升级为 **强制 Intent**，进入状态机，不旁路 |

---

## 3. 目标架构（To-Be）

### 3.1 分层（共同幕布内）

```text
┌──────────────────────────────────────────────────────────────────┐
│ L0  产品策略（配置，非每帧）                                        │
│     liveAutoFollow 开关 · 发送是否强制见最新 · settle 是否 re-pin   │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 只读策略
┌───────────────────────────────▼──────────────────────────────────┐
│ L1  Intent 源（只产生 Intent，不写 scrollTop）                       │
│     UserScrollIntent · ExplicitControl · TurnSend · TurnSettle     │
│     OpenThread · JumpToMessage · RevealHistoryManual · FocusToggle │
└───────────────────────────────┬──────────────────────────────────┘
                                │ Intent 队列（同步优先）
┌───────────────────────────────▼──────────────────────────────────┐
│ L2  Authority Arbiter（唯一状态机 / Single Writer 授权）             │
│     state: ViewportMode + Owner + WriteTicket                       │
│     transition(intent | geometry) → { mode, ticket?, reject? }      │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 仅在持票时
┌───────────────────────────────▼──────────────────────────────────┐
│ L3  Scroll Actuator（纯执行）                                        │
│     Convergence(bottom|top|anchorId) · instant/smooth · recheck     │
│     无业务 if；无 autoScroll 旁路                                    │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 观察
┌───────────────────────────────▼──────────────────────────────────┐
│ L4  Geometry Pipeline（只观测高度/坐标系，不抢权）                    │
│     ResizeObserver · VirtualizerPhase · LiveTailWindow · Measure    │
│     → GeometryDelta { kind, scrollHeight, maxScrollTop, phase }     │
└──────────────────────────────────────────────────────────────────┘
```

**铁律：**

- L1 / L4 **永不**直接写 `scrollTop`
- L3 **仅**在 L2 签发的 `WriteTicket` 有效期内写入
- `MessagesCore` **删除**散落 `container.scrollTop = …`（除迁移期兼容适配器）

### 3.2 ViewportMode（替代碎片 flags）

```text
type ViewportMode =
  | "stick-bottom"      // armed：内容变高/变矮都贴真底
  | "free"              // 用户读历史：高度变不追底；可选 overflow 锚点
  | "forced-bottom"     // 回合边界：短窗内无视 free，钉底（可被新的用户意图打断）
  | "jump-anchor"       // 跳到 messageId；完成后 → free 或 stick-bottom
  | "history-head";     // 显示更早：顶 + free
```

映射产品语义：

| 场景 | Mode |
|------|------|
| 焦点跟随开 + 在底 | `stick-bottom` |
| 用户明确上滚 | `free` |
| 发送 / 进入 working（策略：强制见最新） | `forced-bottom` → 稳态后见 §3.4.2 |
| 回合 settle + 尾窗回全量等 | `forced-bottom` → **几何稳态 + 真底** 后见 §3.4.2（**不是**固定 2.4s 预算窗） |
| 打开会话 | `forced-bottom` → 稳态后见 §3.4.2 |
| 跳旧消息 | `jump-anchor` → `free`（目标测高未稳可二次收敛，仍持 jump ticket） |
| 显示更早 | `history-head` → `free` |
| 焦点跟随关 + 非 forced/jump/explicit | `free`（见 §3.4.2 退役落点） |

### 3.3 Owner 与 WriteTicket

**Mode 与 Owner 映射（禁止双状态漂移）：**

| ViewportMode | ScrollOwner | 说明 |
|--------------|-------------|------|
| `stick-bottom` | `stick` | 1:1 |
| `free` | `none` | 不持票；不写 scroll |
| `forced-bottom` | `forced` | 1:1 |
| `jump-anchor` | `jump` | 1:1 |
| `history-head` | `explicit` 或一次性 write 后 `none` | 顶定位后立即 free |

```text
type WriteTicket = {
  id: string;
  owner: Exclude<ScrollOwner, "none">;
  edge: "bottom" | "top" | { messageId: string };
  motion: "instant" | "smooth";
  generation: number;           // renderScope / thread 代际
  issuedAt: number;
  /** 安全阀：到点仍未稳态 → 最后 pin + reason，然后强制退役。不是「正确性预算」。 */
  safetyTimeoutAt: number;
  /** 短 ring：本代已 applied 的 scrollTop，用于异步 scroll 回声（替代数字指纹主路径） */
  appliedScrollTops: number[]; // bounded，如 8
};
```

**语义分离（评审补洞）：**

| 字段/概念 | 含义 | 不是 |
|-----------|------|------|
| 几何稳态退役 | 正确性完成条件 | 固定 2.4s |
| `safetyTimeoutAt` | 防永远 forced（建议默认 **8000ms**，可调） | 贴底充分条件 |
| `appliedScrollTops` | 本 ticket 代写入回声 | 全局 number 指纹环当主路径 |

**scroll 事件规则：**

```text
onScroll(eventScrollTop):
  if userInputLease.active:
    → Intent UserScroll（见 §3.4.1 是否打断 forced）
  else if activeTicket.generation 匹配
       && eventScrollTop ∈ ticket.appliedScrollTops (±1px):
    → 忽略（程序 / 本代回声）
  else if browserClampProven(prevGeom, nextGeom):  // 高度塌缩钳位，无票写入
    → 记录 clamp 观测；mode∈{forced,stick} 时立即 re-pin 真底；不转 free
  else if distanceToBottom <= FOLLOW_REARM_THRESHOLD_PX (120):
    → 可 re-arm stick（仅 liveAutoFollow 开）
  else:
    → Intent 倾向 free（无明确 input 时需谨慎，优先 clamp/geometry 解释）
```

**启发式未死光：** clamp 几何证明 + ticket 代际 ring 仍需要；**禁止**回到「无票全局 grace 猜用户」。

### 3.4 Authority 优先级（冻结）

从高到低：

```text
P0  ExplicitControl     // 用户点「到顶/到底」
P1  UserScrollIntent    // 明确用户滚动（定义见 §3.4.1）
P2  JumpToMessage
P3  RevealHistoryManual // → history-head
P4  TurnSend / TurnSettle / OpenThread  // forced-bottom
P5  StickBottom         // live-follow 连续贴底
P6  Geometry only       // 无 Owner 时不写；仅更新观测
```

#### 3.4.1 forced 期内 UserScroll 仲裁（P1 vs P4 / D2）

**产品冲突原句：**
「settle 强制 re-pin（即使用户曾上滚）」vs「UserScroll 优先级高于 TurnSettle」。

**冻结规则（可编码）：**

```text
在 mode === forced-bottom 时收到滚动相关信号：

1) 明确用户上滚（满足任一）→ 打断 forced → free
   - wheel/trackpad：deltaY < 0 且 |deltaY| ≥ 4（滤微抖）
   - 或累计向上 delta（同一 lease 窗 320ms 内）≥ 40px
   - 或 PageUp / ArrowUp / Home
   - 或 scrollbar/pointer 拖拽导致 scrollTop 明显离开底（> FOLLOW_REARM_THRESHOLD）
   - 且：非「仅 ticket.applied 回声」

2) 噪声 / 非明确（满足则 **不** 打断 forced）
   - |deltaY| < 4 的微移、单帧惯性残差
   - 与 activeTicket.appliedScrollTops 命中的 scroll 事件
   - browserClampProven 产生的 scroll
   - 无前置 wheel/key/pointer lease、仅 scroll 事件且 scrollTop 仍在 applied 邻域

3) TurnSettle / TurnSend **边沿当帧**：
   - 清除边沿 **前** 的 user-intent lease（保留现网 beginTurnBoundary 语义）
   - 边沿 **后** 的新明确上滚 → 适用规则 1

4) reason code：
   - forced-interrupted-by-user-scroll
   - forced-ignored-noise-scroll
```

**含义：** D2 的「结束 re-pin」指 **边沿强制进入 forced 并清旧 lease**；**不是**在 forced 全程吞掉一切上滚。用户明确要读历史可以走。

#### 3.4.2 forced / open 退役后的落点（跟随开/关）

| liveAutoFollow | 退役条件满足后 |
|----------------|----------------|
| **开** | → `stick-bottom`（继续追后续 grow，直到明确上滚） |
| **关** | → `free`，且 **必须已在真底**（distance≤1px）；之后 **不再** 自动追 late grow |

**跟随关时的 F 合同：**
forced 必须覆盖「合理窗口内所有可预期 late grow」（稳态定义见 §4.4）。
退役后若再出现极端 late grow（如图片 10s 后 onload）：**不**自动 stick（尊重关跟随）；可选 UI「有新内容 · 回底」由 ExplicitControl。
**禁止**退役后立刻 free 但 distance>0。

#### 3.4.3 A / F 关键规则（汇总）

1. **TurnSend → forced**（A）：取消 free；签发 ticket；shrink **不得**打回 free。
2. **TurnSettle → forced**（F）：退役 = §4.4 稳态 + 真底；期间 grow/measure/phase 追新 max。
3. **仅当** 已退役且 free 且明确上滚，才允许离底滞留。
4. shrink/grow 在 forced|stick 下对称贴新 max。
5. virtual phase：先 PreserveOffset，持票 attach；禁止无票 `initialOffset=0`。
6. **safetyTimeout** 仅安全阀（默认 8s）：最后 pin + `settle-timeout-short-of-bottom` 后按 §3.4.2 退役。
7. **禁止**加长旧 `SETTLE_REPIN_WINDOW_MS` 当默认修复。

### 3.5 GeometryDelta 合同

```text
type GeometryDeltaKind =
  | "content-grow"              // 流式/新卡/footer/meta
  | "content-shrink"            // 尾窗裁剪、折叠
  | "measure-late"              // 估高→真高、content-visibility 揭示
  | "chrome-resize"             // composer / status / 底栏 / 安全区 → clientHeight 变
  | "media-load"                // 图片/生成图 onload
  | "hydrate-detail"            // 块级「显示详情」展开
  | "phase-static"
  | "phase-virtual"
  | "finalizing-presentation"   // isWorking 已 false，finalizing 仍改呈现
  | "scope-switch";

type GeometryDelta = {
  kind: GeometryDeltaKind;
  scrollHeight: number;
  clientHeight: number;
  maxScrollTop: number;
  atBottomBefore: boolean;
  phase: "static" | "virtual";
  scopeGeneration: number;
  source?: string;  // 诊断：composer | timeline | virtualizer | img:id | ...
};
```

**PostSettle 几何源清单（F 探针必须覆盖，长短无关）：**

| 源 | 典型时刻 | GeometryDeltaKind |
|----|----------|-------------------|
| 思考折叠 | working↓ 附近 | content-shrink / measure-late |
| staged → full MD | 结束后数百 ms～数 s | content-grow / measure-late |
| live 尾窗 → 全量 | settle | content-grow |
| idle 虚拟化 attach + remeasure | working↓ 后 | phase-virtual + measure-late |
| 工具卡 / fileEdit layout | 结束后 | measure-late |
| 终轮 footer / token meta | finalizing | content-grow |
| **Composer 多行/附件** | 任意 | **chrome-resize** |
| Status Panel / 底栏 chrome | 任意 | chrome-resize |
| 块级显示详情 hydrate | 用户点开或自动 | hydrate-detail |
| 图片 onload | 可远晚于 8s | media-load |
| content-visibility 屏外揭示 | 滚动/layout | measure-late |
| Shared 投影 churn | 不定 | content-grow/shrink |
| isAssistantFinalizing 呈现 | working 已 false | finalizing-presentation |

**L4 职责边界：**

| 模块 | 现在 | 重构后 |
|------|------|--------|
| live 尾窗 | 直接改 items | emit GeometryDelta；不碰 scroll |
| virtualizer | 可能内部写 offset | **仅** L3 持票调用 API（scrollToIndex / measure）；L4 只报 phase 请求 |
| 思考/MD/工具 | 隐式 RO | RO 统一出口 |
| composer/chrome | 多未纳入滚动核 | 监听 resize → `chrome-resize` |
| 行内工具列表 scroller | 子 scroller 自滚 | **不**进入幕布 Arbiter（见 §3.7） |

### 3.6 与引擎 / Shared 的关系

```text
Grok/Kimi/… 过程投影更密 → 更多 content-grow
Shared 投影 churn → 更多 grow/shrink
        │
        ▼
   同一 L4 → 同一 L2
```

**禁止** `if (engine === "grok") scroll…`。
若几何噪声过大：L1 水管节流；forced 期 RO 写频上限见 §4.4。

### 3.7 Single Writer：现网写点清单与归口（As-Is → To-Be）

> Phase 2 切换前必须用 `rg 'scrollTop\s*=' src/features/messages` 复核；本表是 2026-08-01 基线。

| 写点 | 路径 | To-Be 归口 |
|------|------|------------|
| 收敛 / nudge 贴底 | `messagesScrollConvergence.ts`、`useMessagesScrollController` | **L3 Actuator**（持票） |
| 打开历史钉底 / 边界 | Core + controller | Intent Open/Turn* → L2 → L3 |
| manual 显示更早 `scrollTop=0` | `MessagesCore.tsx` | Intent RevealHistoryManual → L3 |
| jump / 锚点定位写 scrollTop | `MessagesCore` / `messagesViewModel` | Intent JumpToMessage → L3（**禁止** Core 直接写） |
| virtualizer scrollToIndex / initialOffset | `useMessagesTimelineVirtualizer` | L3 持 jump/phase ticket 调用；禁止无票 attach |
| ScrollControl | `ScrollControl.tsx` | Intent ExplicitControl → L3 |
| 浏览器 clamp | 无代码写 | L2 识别 + forced/stick 下 L3 re-pin |
| **子 scroller**（Bash/Edit/Search 工具块内部列表） | `*Tool*Block.tsx` | **范围外**：局部 DOM，不进幕布 Owner；文档承认隔离 |
| 测试 mock | `*.test.tsx` | 非产品路径 |

**铁律补强：** 幕布 container 上任意 `scrollTop` 赋值 / virtualizer 视口 API，**必须**有 ticket.id；CI 可加 lint/rg 门禁。

### 3.8 free 模式与 CSS overflow-anchor

| Mode | overflow-anchor |
|------|-----------------|
| `free` / `jump-anchor` | 允许浏览器锚点（中部阅读防被顶走） |
| `forced-bottom` / `stick-bottom` | **必须**避免与追底打架：容器或策略上禁用/忽略 anchor 干扰（实现阶段验证 WebView） |

---

## 4. 状态机（核心转移）

### 4.1 简图

```text
                    OpenThread / TurnSend / TurnSettle
                 ┌────────────────────────────────────┐
                 ▼                                    │
           forced-bottom ──(geometry stable & at true bottom)──► stick-bottom
                 │              ▲
                 │              │ grow/measure/phase while forced：保持 forced，追新 max
                 │ UserScrollUp │
                 ▼              │
                 free ◄─────────┴── (stick 上 UserScrollUp)
                 │
                 ├── ExplicitBottom / FocusOn / near-bottom rearm ──► stick-bottom
                 ├── JumpToMessage ──► jump-anchor ──► free
                 └── RevealManual ──► history-head ──► free
```

### 4.2 A 类（发送飞顶）在状态机上的关闭方式

**旧链路：**

```text
send → items/尾窗 shrink → scrollHeight↓ → browser clamp scrollTop
    → async scroll event → 误判用户上滚 → autoScroll=false → cancel convergence
    → 高度回填 → 视口停在「塌缩期位置」≈ 飞顶/跟丢
```

**新链路：**

```text
send → Intent TurnSend
    → mode=forced-bottom, ticket=forced(gen=N)
    → shrink GeometryDelta
    → Arbiter: mode 仍 forced → Actuator 写 maxScrollTop（持票）
    → 迟到 scroll 事件：有 ticket/gen → 忽略
    → grow/measure-late → 继续贴底直到 ticket 稳定结束 → stick-bottom
```

**不依赖** “指纹是否碰巧命中 1680”。

### 4.2.1 F 类（结束离真底）在状态机上的关闭方式

**旧链路（间歇）：**

```text
working↓ → turn-settle pin 底₁（瞬时 max）
  → 2.4s 内可能追到底₂
  → 其后 full-md / 虚拟化 remeasure / 工具测高 → H₃（时刻随机）
  → 若预算已过且（跟随关 | autoScroll 被 echo/wheel 误杀）
  → 停在假底  ← F 有时出现有时不出现
```

**新链路：**

```text
working↓ → Intent TurnSettle → forced-bottom + ticket
  → 任意 GeometryDelta（含 chrome/media/finalizing）：持票追新 max
  → 退役当且仅当 §4.4 isGeometryStable && distanceToBottom <= 1
  → §3.4.2：跟随开 → stick-bottom；跟随关 → free@真底
  → safetyTimeout：最后 pin + settle-timeout-short-of-bottom → 同上退役
  → 明确用户上滚（§3.4.1）→ free（可中断 forced）
```

**禁止**：用会话长度分支；用单纯加长 `SETTLE_REPIN_WINDOW_MS` 当默认解。

### 4.3 reason code（可观测）

```text
scroll.owner.transition
  scrollerId: "messages-canvas"   // 禁止与文件树 scroller 混淆
  from, to, intent, geometryKind?, ticketId, scopeGeneration, ts,
  distanceToBottom, scrollHeight, clientHeight, phase,
  liveAutoFollow?
```

| code | 含义 |
|------|------|
| `settle-timeout-short-of-bottom` | safetyTimeout 触发时仍离真底（已最后 pin） |
| `forced-interrupted-by-user-scroll` | §3.4.1 明确上滚打断 forced |
| `forced-ignored-noise-scroll` | 噪声未打断 forced |
| `armed-killed-by-echo` | 迁移期：旧 echo 路径误杀 |
| `post-settle-grow-while-forced` | 结束后长高且 forced 仍追（健康） |
| `post-settle-grow-while-dead` | 结束后长高但 owner 已死（F 根因帧） |
| `chrome-resize-re-pin` | composer/底栏导致 clientHeight 变并 re-pin |
| `clamp-re-pin` | 浏览器钳位后 re-pin |

实机排障只读时间线，**不要**用 messageCount 代替。

### 4.4 可编码不变量（实现必须照抄为纯函数/常量）

> 评审补洞：禁止「N 帧」停在散文。以下默认值可在 OpenSpec 调，但 **必须有字面量**。

```text
// --- 阈值 ---
TRUE_BOTTOM_EPSILON_PX = 1
FOLLOW_REARM_THRESHOLD_PX = 120          // 仅 follow 启发式，非真底验收
USER_SCROLL_MIN_DELTA_Y = 4
USER_SCROLL_ACCUM_UP_PX = 40
USER_SCROLL_ACCUM_WINDOW_MS = 320
USER_INPUT_LEASE_MS = 500                 // 与现网同量级；可调
TICKET_APPLIED_RING_SIZE = 8
SAFETY_TIMEOUT_FORCED_MS = 8000           // 安全阀，非正确性预算
STABLE_HEIGHT_WINDOW_MS = 150             // 高度不变观测窗
STABLE_HEIGHT_MIN_SAMPLES = 3             // 窗内至少 3 次采样一致
MAX_STICK_WRITE_HZ = 30                   // forced/stick 下 scrollTop 写入上限
PROBE_SAMPLE_IN_PROD = false              // 生产默认关；dev 全开

// --- 真底 ---
function distanceToBottom(c):
  return max(0, c.scrollHeight - c.clientHeight - c.scrollTop)

function isAtTrueBottom(c):
  return distanceToBottom(c) <= TRUE_BOTTOM_EPSILON_PX

// --- 几何稳态（forced 退役条件之一）---
function isGeometryStable(snapshot):
  // snapshot 由 Geometry bus 维护
  return
    now - snapshot.lastScrollHeightChangeAt >= STABLE_HEIGHT_WINDOW_MS
    && snapshot.sameHeightSampleCount >= STABLE_HEIGHT_MIN_SAMPLES
    && snapshot.pendingVirtualRemeasureCount === 0
    && snapshot.phase === snapshot.phaseDesired   // 无未完成 handoff
    && snapshot.pendingMediaLoads === 0           // 已知 <img> 未 load 完则不稳定
    // 说明：无法登记的极端 late media 不阻塞退役；跟随关时靠 §3.4.2
    && !snapshot.finalizingPresentationActive     // finalizing 呈现未结束则不稳

// --- forced 退役 ---
function canRetireForced(c, snapshot, ticket):
  if isAtTrueBottom(c) && isGeometryStable(snapshot):
    return "stable"
  if now >= ticket.safetyTimeoutAt:
    return "safety-timeout"
  return "hold"

// --- 同帧 Intent 合并顺序 ---
function reduceFrame(intents[], geometry[]):
  1. 先 fold 全部 GeometryDelta（更新 snapshot，不写 scroll）
  2. Intent 优先级：Explicit > UserScroll(明确) > Jump > Reveal > Turn* > FocusToggle
  3. 同一优先级取 last-wins
  4. 最后：若 mode∈{forced,stick} 且 snapshot 高度/client 变 → Actuator pin（受 MAX_STICK_WRITE_HZ）

// --- virtualizer ---
// pendingVirtualRemeasureCount：由 measure/scrollToIndex 生命周期 +/–；
// 无信号时 fail-closed：phase 切换后额外 hold STABLE_HEIGHT_WINDOW_MS。

// --- browser clamp ---
function browserClampProven(prev, next):
  return next.maxScrollTop < prev.maxScrollTop - 1
    && prev.scrollTop > next.maxScrollTop + 1
    && abs(next.scrollTop - next.maxScrollTop) <= TRUE_BOTTOM_EPSILON_PX + 1
```

**与旧常数关系：**

| 旧 | 新角色 |
|----|--------|
| `SETTLE_REPIN_WINDOW_MS=2400` | **废弃为正确性条件**；可作迁移期双跑对照，不作为 To-Be 退役条件 |
| `SCROLL_THRESHOLD_PX=120` | 仅 = `FOLLOW_REARM_THRESHOLD_PX` |
| recheck 100/300/1000/2000 | 收敛实现细节；可保留，但退役不依赖「跑完 recheck 表」 |
| echo grace 350ms | 降级；主路径 = ticket.appliedScrollTops |

**性能不变量：**

- Actuator 写 `scrollTop` **不**进入 React 根 render 链路（继续 ref + rAF；遵守 `docs/perf` 红线）。
- forced 期超过 `MAX_STICK_WRITE_HZ` 合并为每帧最多一次。
- 探针默认 dev；字段上限防爆。

---

## 5. 模块落位（建议路径，实现阶段再改名）

| 模块 | 建议路径 | 职责 |
|------|----------|------|
| 类型与优先级表 | `orchestration/scrolling/scrollAuthorityTypes.ts` | Mode / Intent / Delta / Ticket |
| 纯状态机 | `orchestration/scrolling/scrollAuthorityMachine.ts` | **无 DOM**；可单测穷举转移 |
| Ticket / 程序写入记账 | `orchestration/scrolling/scrollWriteTicket.ts` | 代际、过期、与 scroll 事件对齐 |
| Actuator | `orchestration/scrolling/messagesScrollConvergence.ts`（演进） | 只执行 |
| Geometry 总线 | `orchestration/scrolling/scrollGeometryBus.ts` | RO + phase 统一 emit |
| Hook 门面 | `orchestration/hooks/useMessagesScrollController.ts` | 接线；变薄 |
| Core | `MessagesCore.tsx` | **只派发 Intent**（turn/open/jump/reveal），不写 scrollTop |

**纯函数优先**：状态机 100% Vitest，不依赖 jsdom 滚动度量猜时序。

---

## 6. 与现有止血代码的关系

| 既有资产 | 重构态度 |
|----------|----------|
| `messagesScrollEcho` 指纹 | **降级**：诊断 + 迁移期双跑；正确性改 Ticket |
| `turn-send` / `turn-settle` boundary | **升级**为 Intent，逻辑并入状态机 |
| live-follow stick 资格（不绑 working） | **保留语义**，变成 `stick-bottom` 规则 |
| same-run nudge / rAF coalesce | **保留为 Actuator 实现细节** |
| 流式禁虚拟化 | **保留为 GeometryPhase 策略**直至 handoff 合同测绿 |
| idle 虚拟化 + initialOffset | **纳入 phaseTransition 强制 PreserveOffset** |
| OpenSpec `fix-messages-scroll-echo-follow-loss` | 行为回归 **必须继续绿**；归档时注明被本架构 supersede 的正确性主路径 |
| 统一幕布 plan P0-C 锚点 | 本设计是 P0-C 的 **架构级实现方案** |

---

## 7. 实施分期（原始 PLAN，保留作演进证据）

> 下列 checkbox 是设计评审时的原始计划，不再充当 active backlog。当前进度见 §7.1 与 OpenSpec change。

### Phase 0 — 合同与探针（文档 / 诊断，低风险）

- [ ] 本 DESIGN 评审通过（A+F+间歇性+§3.4.1 仲裁+§4.4 常量）
- [ ] 产品确认 D1/D2/D11/D12；工程确认 D9–D14 字面量可接受
- [ ] 在 dev 打 `scroll.owner.transition` 探针（只读，`scrollerId=messages-canvas`）：
  - A：发送瞬间时间线
  - **F：working↓ 后 ≥3s**（开/关跟随 × 有/无迟到长高；含 chrome-resize 若可）
- [ ] 至少各抓 1 条「F 出现」与「同结构 F 不出现」对照时间线
- [ ] `rg 'scrollTop\s*=' src/features/messages` 与 §3.7 表对齐
- [ ] 冻结 Mode / §3.4.1 / §4.4 / 验收进 OpenSpec delta

### Phase 1 — 纯状态机 + 双跑

- [ ] 实现 `scrollAuthorityMachine` 纯函数 + 穷举测试（含 forced 退役稳态规则）
- [ ] Controller 双跑：旧路径执行，新路径只断言「若按新机决策会怎样」打 log
- [ ] 对比复现：A 发送；**F 结束离底（跟随开/关 × 有/无迟到长高）**；Shared / 快流

### Phase 2 — Single Writer 切换

- [ ] WriteTicket 成为唯一写入口
- [ ] 删除/隔离 MessagesCore 内直接 `scrollTop` 赋值
- [ ] GeometryDelta 总线接管 RO
- [ ] 回归：echo / thrash / settle / turn-send / **post-settle grow** 全套 + **实机 5.x + F 截图级**

### Phase 3 — Geometry 生命周期

- [ ] virtual phase handoff 合同测试
- [ ] live tail shrink **与 post-settle grow** 在 forced/stick 下的贴底证明
- [ ] 评估是否引入 virtuoso-style follow 或 stick-to-bottom 思路（**优先自研状态机 + 现有 convergence**，避免大换库）

### Phase 4 — 收口

- [ ] 移除双跑与 echo 主路径依赖
- [ ] 更新 `conversation-canvas-structure` §滚动（A/F/间歇性）
- [ ] OpenSpec verify + archive

### 7.1 2026-08-01 实现差异与剩余门禁

| 轨道 | 当前状态 | 证据 |
|------|----------|------|
| 状态机与 controller | 已入库 | `b34fdaead`；`scrollAuthorityMachine` 与 controller 接线存在 |
| 自动化任务 | 已完成 | change tasks 除 Human QA 外均已勾选 |
| A 类：发送不飞顶 | 待实机 | Human QA：发送后保持最新内容可见 |
| F 类：结束到真底 | 待实机 | Human QA：focus follow 开/关均验证真底 |
| 用户上滚仲裁 | 待实机 | Human QA：上滚释放，回到底部重新武装 |
| 流程收口 | 待上述证据 | verify → sync → archive |

设计常量与行业模式仍是决策依据；若源码与本文原始 Phase checklist 冲突，以当前源码和 OpenSpec delta 为准。

---

## 8. 验收矩阵（架构级，非单点）

### 8.1 A 类（发送）

| ID | 场景 | 期望 Mode 轨迹 | 禁止 |
|----|------|----------------|------|
| A1 | 长历史发送（>48 闲时虚拟） | free? → **forced-bottom** → stick-bottom | 飞顶、autoScroll 误 false |
| A2 | 发送瞬间尾窗 shrink+grow | forced 全程 | 塌缩帧把 Owner 清掉 |
| A3 | 快流 12+ 增高 | stick-bottom，write 次数受控 | cancel/restart thrash |
| A4 | 上滚读历史再发 | free → **forced-bottom**（产品强制见最新） | 卡在 free 跟丢 |
| A5 | 上滚读历史不发，流式中 | free 保持 | 被 stick 强拉 |
| A6 | settle 尾窗回全量 | forced → stick | 结束离底（亦属 F） |
| A7 | 焦点跟随关 + 发送 | forced 仍钉底（策略） | 依赖 liveAutoFollow |
| A8 | 显示更早 | history-head → free | 被 stick 抢回底 |
| A9 | 跳旧锚 | jump → free | 与 virtual scrollToIndex 双写 |
| A10 | 切会话 | scope gen++，旧 ticket 作废 | 跨会话指纹/offset 污染 |
| A11 | Shared 发送 | 同 A1 | 引擎分叉 |
| A12 | Grok 工具卡密增长 | stick | 引擎 if |

### 8.2 F 类（结束离真底；**不按长短分档**）

| ID | 场景 | 期望 | 禁止 |
|----|------|------|------|
| F1 | 结束 + 焦点跟随开 + 预算后长高 | 贴真底（distance≤1px） | 假底滞留 |
| F2 | 结束 + 焦点跟随关 | settle **稳态前**仍贴真底 | 仅靠 2.4s 碰运气 |
| F3 | 结束 + 尾窗回全量暴涨 | 暴涨后贴真底 | owner 中途死 |
| F4 | 结束 + idle 虚拟化 attach + remeasure | phase 后贴真底 | initialOffset 旧底 |
| F5 | 结束 + 几乎无迟到长高 | 贴真底（对照组：应永远稳） | 误报 F |
| F6 | 结束瞬间误触轻微上滚 | 按产品：可转 free；**非**无输入却离底 | 把 layout 当 wheel |
| F7 | 实机 **distanceToBottom≤1**（滑块仅辅助） | 探针为准 | 只看「正文好像贴着输入框」或误指文件树 |
| F8 | 同结构：忙/闲负载对照 | 时间线可解释；贴底一致 | 「随机」无 reason code |
| F9 | **Composer 增高**（多行）结束态 | chrome-resize 后仍真底 | 忽略 clientHeight |
| F10 | **finalizing** 非 working 长高 | 仍 forced 追 | 只听 isWorking 边沿 |
| F11 | 图片 **晚 onload**（跟随开） | stick 追或安全阀后 stick | owner 死透 |
| F12 | 图片晚 onload（**跟随关**） | 可不追；可显式回底 | 违背关跟随语义 |
| F13 | forced 内 **明确**上滚 | → free，停止 re-pin | 全程吞用户 |
| F14 | forced 内 **噪声** scroll | 保持 forced | 误杀 armed |
| F15 | **A→F 连续**（发送后再结束） | 两段均真底 | 只测单点 |
| F16 | 用户读历史时 settle **不得**在明确 free 后反复拽（边沿后） | 尊重 §3.4.1 | over-fix |

### 8.3 数值 SLO（实机门禁建议）

| 指标 | 目标 |
|------|------|
| settle 后 + safety 前，跟随开，无明确上滚 | `P95 distanceToBottom == 0`（ε=1px） |
| 同上，跟随关 | forced 退役瞬间 `distanceToBottom == 0` |
| forced 期 scrollTop 写频 | ≤ `MAX_STICK_WRITE_HZ` |
| 误指 | 探针必须带 `scrollerId=messages-canvas` |

**门禁：**

- 状态机单测：§4.4 纯函数 + §3.4.1 仲裁表
- forced 期间多次 measure-late / chrome-resize 仍 distance=0
- 禁止仅用 messageCount「长/短」冒充 F
- 组件回归：`Messages.live-behavior` 语义保留或迁移
- **实机**：5.x + A 录屏 + F 矩阵抽样（开/关跟随、有/无迟到长高、composer 变高）
- jsdom = 协议；WKWebView = 时序真相（分层门禁）

---

## 9. 非目标

- 不按 CLI 分叉滚动实现
- **不按会话长短**做滚动策略分叉或根因分类
- 不借机重做 presentation / tool 投影（那是统一幕布另一包）
- 不默认引入重型第三方聊天壳替换 Messages
- 不把 Status Panel **业务逻辑**并入状态机；仅 **chrome-resize 几何**
- 不把工具块 **内部** scroller 并入幕布 Owner
- 不在 Phase 0–1 改虚拟化阈值“调参碰运气”
- 不把单纯加长 `SETTLE_REPIN_WINDOW_MS` 当作 F 的默认修复
- 不宣称「零启发式」：clamp + ticket ring 仍保留，只废除无主的全局 grace

---

## 10. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 双跑期行为不一致 | 默认旧路径生效；新路径只观测 |
| forced 与用户上滚冲突 | **§3.4.1 可编码仲裁**；reason code 可审计 |
| 假稳态（动画/轮询投影） | safetyTimeout 8s；pending 计数 fail-closed hold |
| 永远 forced 饿死 free | safetyTimeout 强制退役 |
| 性能 / 主线程 jank | MAX_STICK_WRITE_HZ；写不进 React 根链；见 docs/perf |
| 探针成本 | 默认 dev；采样/字段上限 |
| Grok 投影 RO 风暴 | L1 节流 + 写频上限 |
| 迁移面大 | Phase 分期；Single Writer feature flag |
| jump 与 stick 双写 | §3.7 全写点归口 L3 |
| 子 scroller 误伤 | 明确范围外 |

回滚：flag 关 → 旧 controller 路径；状态机文件可留作测试资产。

---

## 11. 决策记录

| # | 决策 | 默认建议 | 状态 |
|---|------|----------|------|
| D1 | 发送是否 **总是** forced-bottom | **是** | **已采用并实现；待 A 类实机** |
| D2 | settle 边沿是否 forced（清旧 lease 并 re-pin） | **是**（现网契约） | **已采用并实现；待 F 类实机** |
| D3 | 正确性主路径 | **Ticket 代际 ring > 全局 echo 指纹**；clamp 几何证明保留 | **已实现，echo 兼容双跑** |
| D4 | 是否引入 `use-stick-to-bottom` 依赖 | **否** | **已采用** |
| D5 | 是否换 react-virtuoso | **本阶段否** | **已采用** |
| D6 | OpenSpec change 名 | `refactor-conversation-canvas-scroll-ownership` | **已创建并实施** |
| D7 | F 与 A 是否并列主攻 | **是** | **已确认** |
| D8 | 根因是否按会话长短分类 | **否**（三维） | **已确认** |
| D9 | forced 退役条件 | **§4.4 稳态 + 真底**；safetyTimeout 仅安全阀 | **已实现；待 Human QA** |
| D10 | 真底验收 | **≤1px**；120px 仅 follow re-arm | **已采用为 Human QA 口径** |
| D11 | forced 期内明确上滚 | **打断 → free**（§3.4.1） | **已实现；待 Human QA** |
| D12 | 跟随关时退役落点 | **free@真底**，之后不自动追 | **已实现；待 Human QA** |
| D13 | safetyTimeout 默认 | **8000ms** | **已实现** |
| D14 | 稳态窗默认 | **150ms + ≥3 采样** | **已实现** |

---

## 12. 下一步（当前收口路径）

1. 在实机完成 A 类发送、F 类结束真底、上滚释放/重新武装三组 Human QA。
2. 用 `distanceToBottom <= 1px` 和 reason code 作为证据，不以滑块观感替代。
3. 复核 `rg 'scrollTop\s*=' src/features/messages`，确认 Single Writer 未被后续代码绕过。
4. 执行 OpenSpec verify；证据通过后 sync / archive。

---

## 附录 A — 源码锚点（As-Is）

| 关注点 | 路径 |
|--------|------|
| Controller | `src/features/messages/orchestration/hooks/useMessagesScrollController.ts` |
| Convergence | `src/features/messages/orchestration/scrolling/messagesScrollConvergence.ts` |
| Echo | `src/features/messages/orchestration/scrolling/messagesScrollEcho.ts` |
| Core 接线 | `src/features/messages/components/MessagesCore.tsx` |
| ViewModel 写 scroll | `src/features/messages/orchestration/presentation/messagesViewModel.ts` |
| Virtualizer | `src/features/messages/timeline/hooks/useMessagesTimelineVirtualizer.ts` |
| 虚拟化策略 | `src/features/messages/timeline/virtualization/messagesTimelineVirtualization.ts` |
| ScrollControl | `src/features/messages/components/conversation/ScrollControl.tsx` |
| 子 scroller（范围外） | `toolBlocks/*Tool*Block.tsx` |
| 回归 | `src/features/messages/components/Messages.live-behavior.test.tsx` |
| 写点审计 | `rg 'scrollTop\s*=' src/features/messages` |

## 附录 B — 行业参考链接

- [use-stick-to-bottom](https://github.com/stackblitz-labs/use-stick-to-bottom) — stick / resize / user intent 的参考实现
- [AI Elements Conversation](https://elements.ai-sdk.dev/components/conversation) — auto-scroll 与 jump-to-bottom 的产品层参考
- [MDN: overflow-anchor](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-anchor) — 浏览器 scroll anchoring 标准行为
- [React Virtuoso Message List](https://virtuoso.dev/message-list/) — message list follow / location API 的库级参考

> 参考链接于 2026-08-01 复核。它们用于验证问题域和可选模式，不是 mossx 可直接替换的实现合同；WebView 差异、现有 Ticket/Geometry contract 与实机证据仍是最终约束。

## 附录 C — 术语

| 词 | 含义 |
|----|------|
| **共同幕布** | 全 CLI + Shared 共用的 Messages 呈现核 |
| **Owner** | 当前被授权写滚动的角色 |
| **WriteTicket** | 一次合法程序写入会话 |
| **GeometryDelta** | 高度/坐标系变化事件 |
| **forced-bottom** | 产品强制见最新的短生命周期模式 |
| **stick-bottom** | 用户武装下的连续贴底 |
| **free** | 用户读历史，不追底 |
| **真底 / true bottom** | `distanceToBottom <= 1px`；非 nearBottom(120px) |
| **几何稳态** | 连续 N 帧高度不变 + 无 pending remeasure + phase 稳定 |
| **PostSettleGeometryGrowth** | working↓ 之后仍发生的 scrollHeight 增长 |
| **ArmedKilledByNoise** | echo/wheel/nearBottom 误杀 autoScroll/ stick |
| **safetyTimeout** | forced 最长存活；到点最后 pin 并退役，非贴底充分条件 |
| **chrome-resize** | clientHeight 变化（composer/底栏），可导致「内容没涨但离底」 |
| **明确用户上滚** | §3.4.1 阈值；可打断 forced |
| **噪声 scroll** | 微 delta / 回声 / clamp；不打断 forced |

---

## 附录 D — 红队评审结论摘要（2026-08-01）

| 原缺口 | 落点 |
|--------|------|
| P1 vs P4 / D2 产品冲突 | §3.4.1 |
| 跟随关退役落点 | §3.4.2 |
| 稳态/N 帧不可编码 | §4.4 |
| Ticket expiresAt 与稳态矛盾 | §3.3 `safetyTimeoutAt` |
| 写点漏 jump/virtualizer | §3.7 |
| 几何源漏 composer/media/finalizing | §3.5 清单 |
| clamp / 异步 scroll | §3.3 scroll 规则 + §4.4 browserClampProven |
| 性能 / jank | §4.4 MAX_STICK_WRITE_HZ + §10 |
| 验收负例与 SLO | §8.2 F9–F16 + §8.3 |
| overflow-anchor | §3.8 |

**文档成熟度（原评审 → 当前）**：原稿已具备战略 DESIGN + 可编码默认；D1/D2/D11 随 OpenSpec 实现被采用。当前只剩 A/F/上滚仲裁实机门禁，**不回退**到加长 2.4s 的路径止血。

---

## 修订记录

| 日期 | 变更 |
|------|------|
| 2026-08-01 | 初稿：Scroll Ownership / A 类 / 行业调研 |
| 2026-08-01 | 补 **F 类**、**间歇性三维**、F1–F8、§4.2.1、D7–D10 |
| 2026-08-01 | **红队补洞**：§3.4.1 仲裁、§3.4.2 退役落点、§3.7 写点、§3.5 几何源扩展、§3.8 anchor、§4.4 可编码不变量、F9–F16/SLO、D11–D14、附录 D |
| 2026-08-01 | 对码校准：记录 `b34fdaead`、OpenSpec `23/26`；原始 Phase 保留，active backlog 收敛为 3 项 Human QA |

---

*本文同时保留原始重构设计与实现差异；当前行为以 OpenSpec change + 源码为准。*
