---
type: architecture
status: active
---

# 多引擎协作编排设计（Multi-Engine Collaboration Orchestration）

| 字段 | 值 |
|------|-----|
| 状态 | design / active |
| 日期 | 2026-08-06 |
| 修订 | 2026-08-06：§9 Composer 上下文首段对齐 —— 图/skill/记忆/便签进 `stages[0]`，后续段只吃文字归纳（见 §9） |
|      | 2026-08-06：Code Review 修复 —— featureFlag 默认关闭、三层防御文档化、mergeLiveText 去重、进度条动画去闪烁、CSS GPU 加速、防污染约定落文（§17 新增） |
|      | 2026-08-05：v4 双栏预览稿定稿 —— 右编排面板终局样式 = 07 节点卡片轮播（见 §8） |
| 范围 | Shared Session 内的多 CLI · Provider · Model · 思考强度分环节协作 |
| 产品入口 | Composer「协作」/ Multi-Agent Collab |
| 预览稿 | `docs/previews/multi-agent-canvas-drawer-v4/`（双栏四态全链路可点击 HTML：06 日志控制台 / 07 卡片轮播，hash `#s1`~`#s4` 直达） |
| 非范围 | 引擎原生 Task 子代理 first-class 化；自由 Agent Mesh；Worktree 多写合并 |

---

## 1. 背景与问题

### 1.1 产品语境

mossx（CCGUI）已具备：

- **Shared Session**：跨引擎统一对话与 durable event log
- **Execution Target**：`engine + providerProfile + model + reasoning` 的可冻结快照
- **Scoped Worker Binding**：`squad:{runId}:{stageId}:{engine}:{provider}` 隔离 attempt owner
- **Realtime 隔离**：worker 正文可不进主 Messages 根链，避免 jank

用户真正要的「多 Agent 协作」不是「同一个模型跑三段」，而是：

> 在一条 **仍像普通对话** 的 Shared 会话里，按**有序步骤**把工作交给不同 **CLI × 供应商 × 模型 × 思考强度**；  
> **主幕布**保持对话习惯，步骤卡片可**点开/展开**看该步 **流式执行输出**；  
> **编排（步骤结构、绑定、模板）**放在 **右侧抽屉**；  
> 规划段结束后 **批复门闩**，通过后后续步骤 **自动串行执行**。

### 1.2 历史误区（必须对齐）

| 误区 | 表现 | 正确方向 |
|------|------|----------|
| 单 target 流水线 | 全 run 封印 Composer 当前 target | 每 stage 独立 target（CLI·供应商·模型·思考强度） |
| 假 DAG 调度器 | 强 JSON DAG + Mutate 仅 Codex 死锁 | 先串行步骤编排，主路径可跑通 |
| 编排 UI 抢主幕 | 主幕变成运维大盘/图编辑器，丢掉对话习惯 | **主幕仍是对话幕布**；编排进右抽屉 |
| 流式只在侧栏 | 主幕只有一行摘要，展开看不清执行 | **流式正文在主幕步骤卡内展开**（可同时右抽屉看编排） |
| 与原生子代理混淆 | 右侧变 Claude Task 网格 | 协作抽屉 ≠ 原生子代理 inspector |
| 直播串字 | 累计快照当 delta append | merge 识别 snapshot vs delta |

### 1.3 设计目标

1. **不脱离对话习惯**：协作 run 落在 Messages 时间线里，像「一次增强的用户轮次」。
2. **步骤可观测（主幕）**：每个步骤可点开/展开，在**主体幕布**内看该步流式输出与工具轨迹。
3. **编排可配置（右抽屉）**：步骤顺序、每步要干什么、CLI·引擎·供应商·模型·思考强度·提示词/约束，在抽屉完成。
4. **模板 + 自定义步骤**：内置 3～4 步固定模板；用户可增删改步骤并 **保存为可复用模板**。
5. **批复后自动跑**：规划（或「需批准」步）完成后提供 **批准/打回**；批准后后续节点自动执行，无需逐步点「继续」。
6. **权威可证明 / 失败可见**：Canonical Fact · Projection；失败步在主幕可展开诊断。

### 1.4 非目标（当前波次）

- 自由 DAG / 并行多写者 / worktree merge（可后置）
- 自动「最强模型路由」
- 把引擎原生 SubAgent（Task 工具）升级为协作节点
- 跨 workspace、远程 deploy、自动 git commit/push

### 1.5 产品交互原则（2026-08-05 用户口径 · 必须遵守）

> 前序视觉探索若偏离下列原则，一律作废，以本节为准。

| # | 原则 | 细化 |
|---|------|------|
| P1 | **主幕 = 对话幕布** | 不引入独立「全屏编排工作台」替代会话；用户消息、协作 run 卡、短汇总都在现有 Messages 流里。 |
| P2 | **步骤展开在主幕**（2026-08-05 修订） | 主幕编排卡负责状态/徽章/批准/汇总；**流式全文精读在右编排面板**（终局 = 07 卡片轮播整卡）。主幕历史轮折叠卡可真展开（内嵌该轮完成态编排摘要），并提供链接一键切右栏对应轮次看全文。 |
| P3 | **右抽屉 = 编排 UI** | 打开/配置协作、编辑步骤、选模板、调 target、看整 run 进度总览放在 **右侧抽屉**（与现有右栏 inspector 同一交互范式：可展开/收起、可拖拽调宽）。 |
| P4 | **默认模板 + 自定义步骤** | 产品提供固定 3～4 步模板（如规划/实现/审查）；用户可自定义：步骤名、要干什么（说明/系统提示/用户提示片段）、CLI+供应商+模型+思考强度、权限（read-only/current）等。 |
| P5 | **结构可复用** | 用户编好的步骤结构可 **存为模板**；下次一键套用（结构固定，任务正文每次新填）。 |
| P6 | **规划批复门闩** | 规划步（或标记 `requiresApproval` 的步）结束后 **必须** 出现批准/打回；批准后 **后续步骤自动执行**，不再逐步确认（除非某步也标记需批准）。 |
| P7 | **串行优先** | V1 执行语义仍是有序串行；自定义步骤只改「有哪些步、每步谁干」，不默认开放并行多写。 |
| P8 | **轮次可见可切** | 同会话二轮协作时：主幕 = 历史轮折叠卡 + 新编排卡并存；右栏轮次段控件自「进行中」起**常驻**，未开始的轮次置灰并拦截提示，进入二轮自动选中最新轮。 |

---

## 2. 产品定义

### 2.1 一句话

**Multi-Engine Collaboration** 是 Shared Session **对话幕布上的串行多引擎管线**：步骤定义（模板或自定义）与绑定在 **右抽屉** 完成；运行时每个步骤在 **主幕** 以可展开卡片呈现 **流式执行**；规划批复后自动跑完后续步骤，并在主幕收口短汇总。

### 2.2 角色与界面分工

| 角色 / 区域 | 职责 |
|-------------|------|
| **用户** | 开协作、编辑/选用模板、发送任务、批复规划、停止、展开某步看流 |
| **Control Plane（mossx）** | 准入、串行调度、attempt owner、投影、取消、短汇总落盘 |
| **Stage Worker** | 某 CLI runtime 上一次 ordinary turn |
| **主幕布（Messages）** | 用户气泡 + **协作 Run 卡**（步骤列表、批准条、可展开流式区、终态汇总） |
| **右侧抽屉** | **编排面板**：模板库、步骤编辑器、每步 target/提示词、整 run 进度条、打开/关闭协作 |

### 2.3 默认模板（内置 3～4 步，可改）

| Stage ID | 标题 | 默认权限 | 默认职责 |
|----------|------|----------|----------|
| `plan` | 规划 | `read-only` 优先 | 产出可确认计划；**requiresApproval=true** |
| `implement` | 实现 | `current` | 按已批计划执行；自动开跑 |
| `review` | 审查 | `read-only` 优先 | 检查 + 生成短汇总；自动开跑 |
| `summary`（可选第 4 步） | 汇总 | `read-only` | 若审查不兼汇总，可拆出专门汇总步 |

**默认绑定**：未逐段配置时，各步可继承当前 Shared Session target；结构上每步仍有独立 `ExecutionTarget` 槽位。

### 2.4 自定义步骤与模板（产品能力）

用户可在右抽屉：

1. **从内置模板起步**，或 **空白管线** 从零加步。  
2. 对每一步编辑：  
   - 显示名 / 角色说明（「要干什么」）  
   - **CLI（engine）** + **供应商（providerProfile）** + **模型** + **思考强度（reasoningEffort）**  
   - 权限 `accessMode`  
   - 提示词层：步骤 system/developer 补充、可选固定 user 前缀  
   - 是否 `requiresApproval`（默认仅规划为 true）  
3. **保存为命名模板**（结构 + 绑定默认值；不含某次任务正文）。  
4. 下次发送前 **一键套用模板**，只改任务描述即可开跑。

```text
CollaborationTemplate
  id, name, description?
  stages[]  // 有序；每步含 title, rolePrompt, target, accessMode, requiresApproval, ...
  version, updatedAt
```

### 2.5 主路径（Happy Path · 修订）

```text
用户打开右抽屉 → 选模板或编辑自定义步骤 → arm 协作
  → 主幕 Composer 发任务（对话习惯不变）
  → 主幕出现协作 Run 卡（步骤折叠列表）
  → Stage plan running  → 用户点开该步 → 主幕内流式输出
  → Plan 完成 → 主幕批准条（批准 / 打回重规划）
  → 用户批准
  → implement / review / … 自动串行
       每步：折叠看状态；点开看主幕流式
  → RunSucceeded → 主幕短汇总（折叠默认；可展开审查全文）
  → 右抽屉显示本 run 只读轨迹 +「存为模板」入口
  →（可选）主对话再发一条 → 开启第二轮：主幕历史轮折叠卡 + 新编排卡；右栏轮次段控件切轮（P8）
```

### 2.6 主幕布 vs 右抽屉（硬规则 · 修订）

| 区域 | 必须展示 | 禁止 / 避免 |
|------|----------|-------------|
| **主幕布** | 用户消息；协作 Run 卡；**每步可展开的流式区**；规划 **批准/打回**；终态短汇总 | 用独立全屏编排页替换会话；把步骤流式 **只** 丢到侧栏导致主幕「看不见干活」 |
| **右抽屉** | 模板列表/编辑；步骤增删排序；每步 CLI·供应商·模型·思考强度·提示词；整 run 进度总览 | 作为 **唯一** 看执行流的地方（流式以主幕展开为准；抽屉可镜像进度，不替代） |
| **完成后主幕** | 短汇总默认折叠友好；步骤仍可点开回看该 attempt 全文 | 把三步长文无折叠地全量倾倒进时间线 |

### 2.7 与「当前骨架实现」的差距（实现 backlog 提示）

| 能力 | 骨架现状（约） | 目标 |
|------|----------------|------|
| 主幕步骤展开流式 | 偏摘要 + 右栏直播 | **主幕编排卡状态 + 右栏整卡流式精读**（P2 修订口径） |
| 右抽屉编排 | 弱 / 与 inspector 混 | **明确协作编排抽屉**；终局 = 07 卡片轮播（§8.3） |
| 自定义步骤 + 模板 | 固定 plan/implement/review | **可编辑可复用 CollaborationTemplate**；页内模板管理模态（§8.4） |
| 批复后自动跑 | 有门闩语义 | 保持；自定义步可配置 `requiresApproval` |
| 轮次 / 二轮协作 | 单 run 视角 | **轮次段控件常驻可切**；历史轮折叠卡 + 链接联动（P8） |

---

## 3. 领域模型

### 3.1 CollaborationRun

```text
CollaborationRun
  runId
  workspaceId / workspaceRoot / sessionId
  requestText
  defaultTarget          // 入口 target；权威在 stages[].target
  status                 // 见状态机
  planRevision           // 规划修订号（确认时对齐）
  plan?                  // PlanDraft（确认用，非最终答案）
  stages[]               // 有序
  activeAttemptIds[]
  diagnostics[]
  finalSummary?          // 短汇总
  requestedAt / approvedAt? / updatedAt
```

### 3.2 Stage

```text
Stage
  id                     // plan | implement | review | 用户自定义 id
  title / role           // 显示名与「要干什么」短说明
  rolePrompt?            // 步骤级提示词/约束（自定义关键）
  target                 // ExecutionTarget：engine + provider + model + reasoningEffort
  accessMode             // read-only | current
  requiresApproval       // 默认：规划 true，其余 false
  status                 // pending | running | succeeded | failed | skipped | awaiting-approval
  attemptId? / bindingKey?
  startedAt? / settledAt?
  shortOutcome?          // 折叠态一行摘要
  // 展开态：主幕挂载该 attempt 的 live/history 流式投影（非 shortOutcome）
  error?
```

### 3.3 PlanDraft

规划段产物，仅服务「确认」与实现段上下文：

```text
PlanDraft
  schemaVersion = 1
  summary        // 一句话
  markdown       // 步骤/风险/验收
  steps[]?       // 可选列表
```

### 3.4 PreparedAttempt

调度输出，供前端 drive ordinary turn：

```text
PreparedAttempt
  runId, stageId, attemptId, logicalTurnId
  bindingKey, target, accessMode
```

---

## 4. 状态机

### 4.1 Run 状态

```text
                    ┌──────────────┐
                    │   Planning   │
                    └──────┬───────┘
                           │ plan stage succeeded
                           ▼
                  ┌────────────────────┐
                  │ AwaitingApproval   │
                  └─────────┬──────────┘
                            │ user approve
                            ▼
                  ┌────────────────────┐
                  │   Implementing     │
                  └─────────┬──────────┘
                            │ implement succeeded
                            ▼
                  ┌────────────────────┐
                  │    Reviewing       │
                  └─────────┬──────────┘
                            │ review settled
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         Succeeded       Failed      Cancelled
```

说明：

- **AwaitingApproval 是产品门闩**（默认开启）：未确认不进实现。
- 审查启动失败但实现已成功时，可 **降级 settle succeeded**，`finalSummary` 用实现短说明（实现层已有此兜底）。
- `Failed` / `Cancelled` 为 terminal；diagnostics 必可展示。

### 4.2 Stage 状态

```text
Pending → Running → Succeeded
                  → Failed
Pending → Skipped   // run 取消或上游失败跳过
```

### 4.3 调度规则（V1）

1. **严格串行**：仅上一段 `succeeded` 后才启动下一段。
2. **单 session 单 active run**。
3. **每 stage 最多一个 active attempt**（重试可后续加预算）。
4. **exact owner**：interrupt / recover 只认 durable `attemptId` + bindingKey。
5. **不解析 prose 驱动状态**：只认 turn terminal + control plane 写入的 outcome fact。

---

## 5. Target 与权限

### 5.1 Execution Target

与 Shared Session 一致：

```text
engine
providerProfileId / providerProfileSource / providerProfileNameSnapshot
modelCatalogEntryId / model
reasoningEffort?
runtimeCapabilityFingerprint?
```

Turn 创建时冻结为 `TurnExecutionSnapshot`，不因 Picker 后续变更而漂移。

### 5.2 每 Stage 独立 Target

```text
stageBindings: [
  { id: "plan",      target: T_plan },
  { id: "implement", target: T_impl },
  { id: "review",    target: T_review },
]
```

- 未提供 bindings → 三段 = 入口 `target` 克隆。
- 提供部分 bindings → 按 id 覆盖对应 stage。
- 每段独立 `validate_resolved_execution_target` + 引擎准入。

### 5.3 权限类

| Stage | accessMode | 说明 |
|-------|------------|------|
| plan | 优先 `read-only` | 规划禁止写盘；无硬只读引擎可降级 `current` 但 prompt 仍禁写 |
| implement | `current` | 允许工作区变更 |
| review | 优先 `read-only` | 审查与短汇总，默认不写 |

### 5.4 写盘能力（产品策略）

- **推荐**：实现段使用 Codex（工作区沙箱与现有 Shared 写路径更成熟）。
- **允许**：其他 Shared 引擎跑实现段；失败 fail-visible，不静默吞。
- **禁止**：自动 commit / push / deploy / 出 workspace。

### 5.5 支持的引擎集合（V1）

与 Shared Session 可执行集对齐：`codex` / `claude` / `kimi` / `grok` / `opencode`。  
**不限制** Claude 下的供应商（MiniMax、官方、自建网关等）——限制的是 **engine 能力**，不是供应商名单。

---

## 6. 持久化与 Fact 映射

### 6.1 原则

- SharedEventWriter 仍是唯一写权威。
- V1 **复用**既有 `squad.*` fact wire（减少 schema 爆炸），**语义重写**为 multi-cli collab：
  - `stageId` 写入 `squadNodeId` / outcome `node_id`
  - `stageBindings` 写入 `SquadRunRequested.extra`
  - 新写入标记 `orchestration: multi-cli-collab-v1`
- 历史旧 Squad DAG 事件只读兼容，不再作为新写入模板。

### 6.2 Fact → 语义

| Fact | 协作语义 |
|------|----------|
| `squad.runRequested` | Run 创建 + stageBindings + workspaceRoot |
| TurnRequested（带 squad* extra） | Stage 开始 / attempt 绑定 |
| `squad.planProposed` | 规划草稿就绪 → AwaitingApproval |
| `squad.planApproved` | 用户确认 → 可启动 implement |
| `squad.nodeOutcomeRecorded` | Stage 结算（plan/implement/review） |
| `squad.branchBlocked` | 失败诊断 |
| `squad.cancelRequested` | 取消意图 |
| `squad.runSettled` | Run 终态 + finalSummary |

### 6.3 Projection

`AgentProjectionV1` 由 pure projector 从事件重建：

- 不写 runtime 侧车状态
- 重启后可恢复 stages 状态与 shortOutcome
- `finalSummary` 为**调度者综括本轮各节点**（表格 + 分段要点，非末段原文复读）；`fullOutcome` 供右栏 Messages 全文；`shortOutcome` 仍为 chip 短截（160）
- 协作启动：主幕布先做调度对话（Shared V2 主路径），结束后再启动规划节点 worker

---

## 7. Runtime 执行

### 7.1 Worker Turn

每 stage 通过既有 `begin_squad_worker_turn_core`（或后续重命名的 `begin_agent_stage_turn`）：

```text
bindingKey = squad:{runId}:{stageId}:{engine}:{provider}
```

- 与主对话 linear attempt 隔离
- 支持 exact interrupt / recover
- Context 最小：任务原文 + 上游 short/plan 必要上下文（实现段带 PlanDraft；审查段带实现短说明）

### 7.2 前端 Executor 驱动

```text
requestRun → drive(planAttempt) → recordPlan
approve → drive(implementAttempt) → recordExecute
       → drive(reviewAttempt) → recordReview → settled
```

- drive = prepareDelivery + dispatchTurn + awaitTerminal
- 超时 / 模糊 recovery → cancel 或 fail-visible，禁止 blind replay

### 7.3 实时直播通道

```text
AppServer realtime
  → 若 attempt 属于 collab stage
  → 不写主 Messages 根链
  → 写入 livePhaseChannel（按 workspace+thread）
  → Inspector /（可选）阶段预览订阅
```

**合并规则**（避免串字）：

- 新文本以旧文本为前缀 → 视为累计快照，**替换**
- 否则 → 真 delta，**append**
- 重复段 / 回退更短快照 → 忽略

### 7.4 与引擎原生子代理的关系

- Collab **不**把 Task/SubAgent 当 first-class stage。
- 规划 prompt **禁止**工具与子代理；模型违令时可能出现引擎层「用户已中断」——属引擎生命周期，不是协作 stop。
- UI：**协作 run 活跃时，协作 Inspector 优先于原生子代理分屏**，避免抢屏。

---

## 8. UI / UX 规格

### 8.0 终局形态选型（2026-08-05 · v4 预览稿定稿）

> 预览稿：`docs/previews/multi-agent-canvas-drawer-v4/`（`index.html` 进；06/07 两例共享左主幕布，右栏形态不同，全链路可点击）。

| 项 | 定稿 |
|----|------|
| **布局** | 双栏：左 = 主幕布（消息流 + 编排卡 + Composer，结构固定模板）；右 = 编排面板（形态自由发挥）；中间**拖拽拉手**调宽（约 320–780px）。无会话头部行、无全局状态切换行。 |
| **右栏终局样式** | **07 节点卡片轮播**：一次一节点整卡流式精读；底栏一栏两用 —— 左 = 轮次段控件，右 = 箭头/圆点翻页。 |
| 备选形态 | 06 全量日志控制台（行号日志流；顶部组合工具栏 = 轮次段控件 + 分隔线 + 环节过滤 chips），偏诊断/排查向，可作为「查看原始日志」模式保留。 |
| 轮次切换 | 自「进行中」起常驻；未开始轮次**置灰 + toast 拦截**；进入二轮自动选中第二轮；切轮次后卡片组/过滤组同步重算。 |
| 四态旅程 | ① 触发·选模板 → ② 进行中 → ③ 终态 → ④ 二轮协作；预览稿支持 hash `#s1`~`#s4` 直达各态。 |
| 视觉 | shadcn 暗色风（zinc 色板、白底黑字主按钮、6–10px 圆角），与客户端现有基调一致。 |

### 8.1 入口（Composer 内，非独立开关/独立页）

- Composer 工具栏 **「⚡ 协作 · {模板名}」pill**：点击开**弹层**选模板（内置模板 + 我的模板，当前项标「✓ 当前」，自定义项 violet 标签）。
- 弹层内 **⚙ 管理模板 / ＋新建模板** → 打开**页内模板管理模态**（§8.4），不跳独立页面。
- 发送即按所选模板 arm 并启动 run；活跃 run 时禁止重复 arm。
- 仅 Shared Session + 完整 target。
- **Composer 上下文**（图 / skill / 记忆 / 便签等）按 **§9 首段对齐** 进入管线，不再整类拒绝。

### 8.2 主幕布编排卡（v4 形态）

```text
┌ ⚡ 协作编排 · 第一轮 ── 规划 → 实现 → 审查 ────── [进行中 · 实现] ┐
│ ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░  进度条                                     │
│ ● 规划    claude · sonnet-4.6 · thinking high          ✓ 1m12s  │
│ ● 实现    codex · gpt-5.3-codex · medium               ● 流式中…  │
│ ○ 审查    grok · grok-4 · medium                       排队       │
├ awaiting-approval 时内联批准条：                                   ┤
│ [✓ 批准，后续自动执行]  [打回重规划]                                │
└──────────────────────────────────────────────────────────────────┘
```

- stage 行 = 状态点 + 步骤名 + **CLI · 模型 · 思考强度**徽章 + 耗时/状态；随所选模板渲染对应步骤集。
- 规划完成后批准条**内联**出现（P6 门闩）；批准后后续步骤自动串行，不再逐步确认。
- 终态：卡下方投**短汇总**块（克制，≤约 12 行量级）；主对话另投一条 assistant 短消息。

**历史轮折叠卡（④态主幕）**：

```text
✓ 第一轮协作 · 修复侧栏 hydration   默认三步 · 3/3 完成 · 4m03s   [展开 ▾]
```

- 「展开 ▾」**真展开**：内嵌该轮完成态编排卡（各步 ✓ + 耗时）+ 链接「在右侧查看第一轮完整输出 →」，点击即切右栏轮次（左右联动）。
- 第二轮进行中时主幕在其下追加新编排卡（如「模板：修复流水线 · 无批准点 → 全自动」），卡片下方用文字链接支持「第二轮输出见右侧 / 切回第一轮」。

### 8.3 右编排面板 = 07 卡片轮播（终局选型）

```text
┌ 实现  2/4 ──────────────────────────────────────── ● LIVE ┐
│ codex · gpt-5.3-codex · thinking medium                   │
│ ───────────────────────────────────────────────────────── │
│ $ apply_patch src/features/sessions/stores/sessionStore…  │
│ + it('hydrate 与 loadEarlier 交错不丢项', ...)            │
│ ✓ patch applied (2 hunks, +48 −0)                         │
│                                                           │
│ （整卡流式精读区，可滚动）                                  │
├───────────────────────────────────────────────────────────┤
│ [第一轮 ✓] [第二轮 ●]                [‹] ●●○○ [›]          │
└───────────────────────────────────────────────────────────┘
```

- **一次一节点**：卡头 = 步骤名 + 序号 n/N + CLI·模型·思考强度 + 状态徽章（● LIVE / ✓ 耗时 / 排队 / 已批准）。
- **底栏**：左 = 轮次段控件（P8 规则）；右 = 箭头 + 圆点翻页；切轮次自动重置到该轮首张卡并按 n/N 重建圆点。
- 备选：**06 全量日志控制台** —— 行号日志流，顶部组合工具栏（轮次段控件 + 环节过滤 chips，轮次切换时过滤组同步换成该轮步骤），用于排查取向场景。

### 8.4 模板管理（页内模态，非独立页）

- 布局：左 = 模板列表（内置/我的分组、搜索、新建）；右 = 步骤编辑器。
- 每步可编辑：**步骤名、CLI、模型、思考强度（low/medium/high 段控件）、提示词（textarea）、是否需批准（toggle）**；拖拽把手排序、删除步骤、＋添加步骤。
- 底部：设为默认 / 删除模板（我的模板）/ 取消 / **保存**（toast 确认，保存后弹层列表即见新模板）。
- 数据形态即 §2.4 `CollaborationTemplate`；内置模板只读不可删。

### 8.5 完成态（正确表达）

应表达：

```text
✓ 规划  Claude · MiniMax     摘要一行
✓ 实现  Codex · …            改动一行
✓ 审查  Claude · …           通过
────────
短汇总：…（≤约 12 行量级）
```

禁止：把 README 分析长文塞满完成卡。

### 8.6 Composer 上下文首段对齐（Context Fan-in · 2026-08-06）

**产品模型（统一）：**

> Composer 上用户选择的 **全部上下文**（可多条）只进入模板 **`stages[0]`（首段）**；  
> 首段负责识图 / 消化 skill / 记忆 / 便签等；  
> **后续段只接收首段归纳后的文字**（`plan` / `short_outcome` / `body` / `upstream_notes`），**不再**重传原图、原附件或重挂 skill/记忆/便签。

```text
用户任务正文
  + 多图 images[]
  + 多个 skill（/skill 拼进正文 + 可选 skillInvocations）
  + 多条记忆（注入进 model text）
  + 多张便签（文本注入 + 便签附图并入 images）
  +（能并进同一发送面的其它引用，同规则）
        │
        ▼
  【stages[0]】完整注入（对齐普通 Shared 发送能力面）
        │  产出 plan / short_outcome / body（纯文字，已含图意与引用事实）
        ▼
  【stages[1..]】仅文本接力；images=[]；不重挂 context 原件
```

| 规则 | 说明 |
|------|------|
| **注入位点** | 仅 `stages[0]` 的 worker turn（`TurnRequested.input`） |
| **文本** | 发送前：记忆/便签正文注入 model text；skill **读 SKILL.md 正文**注入（协作不靠 slash 解析）；→ `request_text` / 首段 prompt |
| **图片** | `images[]`（含便签附图）仅写入 **首段** `image_refs`；dispatch 从 durable 回填；后续段不带图 |
| **主幕气泡** | 只显示用户可见原文（及缩略图），**不**把记忆/便签私有注入块刷进用户气泡 |
| **多个** | 与普通 Composer 同上限；下游吃的是 **一份文字归纳**，不是 N 份原件 |
| **重试** | 重试首段：可再带 run 上冻结的 `firstStageImages` + 同一 `request_text`；重试中间段：不带图 |
| **失败可见** | 首段引擎不识图 / 注入失败 → 明确错误，禁止静默丢附件 |
| **刻意不做** | 每段重传原图；自由 DAG；跨 run 共享附件 blob 新存储（路径引用即可） |
| **本波暂缓** | Browser Context / Intent Canvas 未并入首段注入链时仍拦截（避免静默丢） |

**与旧 V1 门禁的关系：**

- 删除「协作暂不接收附件 / 不支持 skill·记忆·便签」整类拦截。  
- 工程不是「只删 toast」：必须 **首段真正接线**（text 注入 + images 进 begin turn）。

**实现落点（契约）：**

| 层 | 行为 |
|----|------|
| Composer | 协作提交时 **不再** `multiAgentContextBlockReason` 拦截 |
| `useThreadMessaging` squad 分支 | 先做记忆/便签/图 sanitize（与普通发送同源），再 `requestAgentPlan({ text, images, visibleText })` |
| `shared_agent_request_run` | 接受 `images?: string[]` + `visibleText?`；写入 run extra `firstStageImages` / `userVisibleText`；首段 `begin_stage_turn(..., images)` |
| `begin_squad_worker_turn_core` | 支持 `image_refs`（对齐 `begin_turn_core`） |
| `shared_session_v2_dispatch_turn` | 调用方未传图时，从 durable `TurnRequested.image_refs` 回填后交给 CLI（协作 drive 路径依赖此 SSOT） |
| 后续段 | `start_stage_attempt` → `images = None`；「用户任务」用 `userVisibleText`；继续 `last_succeeded_notes` 文本接力 |
| 首段 prompt | 要求：先消化附件与引用，关键事实写入 SUMMARY/计划/短说明，供下游使用 |
| 纯图 | `text` 可空 + `images` 非空 → 占位「（请根据附图回答）」；禁止静默丢图 |

**验收：**

1. 协作 + 多图：首段模型能描述图；下游 implement/review 文案引用图中事实且无二次附图。  
2. 协作 + skill：首段 prompt 含 skill 指令（至少 slash 正文）。  
3. 协作 + 记忆/便签：首段 model text 含注入块；主幕用户气泡保持干净。  
4. 无上下文时行为与改前一致。

---

## 9. API 契约（Tauri）

| Command | 作用 |
|---------|------|
| `shared_agent_request_run` | 创建 run + stageBindings + 启动 plan attempt |
| `shared_agent_record_plan` | 规划 turn terminal → PlanDraft + awaiting-approval |
| `shared_agent_approve` | 确认 revision + 启动 implement attempt |
| `shared_agent_record_execute` | 实现结算 + 启动 review attempt |
| `shared_agent_record_review` | 审查结算 + run settled + finalSummary |
| `shared_agent_get` | 最新 projection |
| `shared_agent_cancel` / `shared_agent_finalize_cancel` | 取消与收口 |

**Request 关键字段：**

```json
{
  "workspaceId": "...",
  "threadId": "shared:...",
  "text": "用户任务（可含 skill/记忆/便签注入后的 model text）",
  "images": ["/abs/path/a.png"],
  "target": { "engine": "claude", "model": "...", "...": "..." },
  "stageBindings": [
    { "id": "plan", "target": { "engine": "claude", "...": "..." } },
    { "id": "implement", "target": { "engine": "codex", "...": "..." } },
    { "id": "review", "target": { "engine": "claude", "...": "..." } }
  ]
}
```

- `images`：**仅首段** worker turn 消费；可空。路径列表写入 run extra `firstStageImages` 供首段重试。

**Response 关键字段：**

```json
{
  "projection": { "runId": "...", "status": "...", "stages": [ /* ... */ ] },
  "stageAttempt": { "stageId": "plan", "attemptId": "...", "bindingKey": "...", "target": {}, "accessMode": "read-only" }
}
```

---

## 10. Prompt 契约（Stage 输入）

### 10.0 首段上下文消化（所有 templates 的 stages[0]）

- 输入可含：用户任务 + 注入的 skill/记忆/便签正文 + **多模态图片**（若有）
- **必须**先消化附件与引用，把图中事实、引用要点写入输出（SUMMARY / 计划 / 短说明）
- 下游段 **不会**再看到原图或原注入块，只靠本段文字

### 10.1 Plan / 首段需批准

- 只产出计划文本；**禁止**写盘工具 / Task / 子代理（读图属于用户消息多模态，不是工具）
- 输出 `SUMMARY:` + Markdown + 可选 `STEPS:`
- 信息不足 → 写假设；有图时先客观描述再规划

### 10.2 Implement

- 输入：用户任务 + PlanDraft（**无图**）
- 允许工作区变更；禁止 commit/push/deploy
- 结束说明控制在短 Markdown（实现层再截断 shortOutcome）

### 10.3 Review / 末段

- 输入：任务 + 计划摘要 + 上游 short_outcome（**无图**）
- **只输出短汇总**（完成了什么 / 关键改动 / 如何验证 / 风险）
- 禁止长分析、禁止大段贴码、默认禁止写盘工具

---

## 11. 失败、取消与恢复

| 场景 | 行为 |
|------|------|
| Plan 空/不可解析 | fail-visible + diagnostics；run failed |
| 用户不确认 | 可停在 awaiting-approval；cancel 收口 |
| Implement 失败 | run failed；review 不启动 |
| Review 起不来但 implement 成功 | 可降级 succeeded + 实现短说明作汇总 |
| 用户 Stop | cancel intent → interrupt exact attempts → settled cancelled |
| 进程崩溃 | 从 facts 重建 projection；running attempt recover 或 fail closed |
| Target 变更 | stage 已冻结 target，不跟 Picker |

---

## 12. 性能与渲染

1. Stage 正文 **禁止**每 delta 进 AppShell 根 reducer。
2. Live 通道独立订阅；cadence 合并（如 ~48ms）降低 inspector 抖动。
3. 主卡只吃 projection 状态事件（低频）。
4. 长列表 / 多 run 历史：只保留最新 active run 于 session；历史 projection 可按需 hydrate。

参照：`docs/perf/render-jank-knife-experiments-2026-07-08.md`、`docs/perf/a4-live-text-externalization-plan.md`。

---

## 13. 安全与权限边界

- Workspace root 在 run 请求时封存；运行中 root 变化 → fail closed。
- 实现段不得越权出 workspace、不得碰 credentials 路径（依赖 CLI 沙箱 + prompt 约束）。
- 不自动 git commit / push / reset / stash。
- Kill switch：`CCGUI_AGENT_ORCHESTRATION_V1` / 前端 flag，关闭后禁新 run，历史可读。

---

## 14. 代码落点（当前仓库）

| 层 | 路径 |
|----|------|
| 后端 control plane | `src-tauri/src/agent_orchestration/**` |
| Tauri commands | `shared_agent_*`（`command_registry.rs`） |
| 前端 feature | `src/features/multi-agent/**` |
| 服务 | `src/services/tauri/agentOrchestration.ts` |
| 样式 | `src/styles/multi-agent.css` |
| i18n | `src/i18n/locales/{zh,en}/multiAgent.ts` |
| 发送入口 | `useThreadMessaging`（`squadRequest` + stageBindings） |
| Realtime 旁路 | `useAppServerEvents` → livePhaseChannel |

> 文档描述 **目标产品架构**；若实现与文档冲突，以本设计 + 后续 OpenSpec change 校准为准，再回写代码。

---

## 15. 验收标准

### 15.1 功能

1. 协作发送后主卡展示 **三段编排**，每段可见 **CLI · 模型徽章**。
2. 规划结束后状态为 **待确认**；未确认不进实现。
3. 确认后按序 **实现 → 审查**；点某段右侧只播该段。
4. 成功后主卡/主对话仅 **短汇总**，无半屏 dump。
5. 停止可收口 terminal；diagnostics 失败可见。
6. 传入不同 `stageBindings` 时，各段使用各自 target（契约层）。

### 15.2 体验

1. 协作活跃时不被原生子代理面板抢屏。
2. 直播无「双重串字」。
3. 规划中主幕不空白到「无生命周期」——至少有三段卡与状态。

### 15.3 工程

1. `cargo check` / `tsc --noEmit` 通过。
2. 不把高频 delta 写进根 reducer。
3. Session 单 active collab run。

---

## 16. 演进路线

| 阶段 | 内容 |
|------|------|
| **V1（当前设计）** | 固定 plan → confirm → implement → review；串行；每段 target 契约；主编排 + 节点直播 + 短汇总 |
| **V1.1** | Composer 内逐段选 CLI/供应商 UI；默认「实现推荐 Codex」提示 |
| **V1.2** | Stage 级重试预算；审查可选跳过 |
| **V2** | 有限并行只读 fan-out；用户自定义 N 段；模板市场 |
| **V3** | 受控 DAG / 条件边；仍禁止无协调多写 |

---

## 17. 边界安全与隔离（Boundary & Safety）

### 17.1 三层防御

协作功能不得影响普通 CLI 对话，通过三层 gate 严格隔离：

| 层级 | Gate | 文件 | 行为 |
|------|------|------|------|
| **L1 入口 UI** | `agentArmed` + `isSharedSessionResolved` + `isMultiAgentTargetSupported` | `Composer.tsx:3154` | 非 Shared Session 不渲染协作 pill |
| **L2 发送管道** | `squadRequest` + `isMultiAgentEnabled()` | `useThreadMessaging.ts:619-628` | `threadKind !== "shared"` 直接拒绝 |
| **L3 Rust 端** | `require_agent_enabled()` | `support.rs:29-43` | 未设置 env 则拒绝所有 agent command |

L1 与 L2 确保：非 Shared Session 线程完全不受影响，普通 CLI 对话走原有路径。

### 17.2 Feature Flag 设计

```text
VITE_CCGUI_AGENT_ORCHESTRATION_V1=1   → 启用（env）
localStorage "ccgui.agentOrchestrationV1" = "1"  → 启用（运行时）
```

**默认关闭**。两层存储按优先级：localStorage > env > default(false)。

前端 `isMultiAgentEnabled()` 与 Rust `require_agent_enabled()` 独立判定，互为纵深防御。

### 17.3 Canvas 消息防污染

协作 briefing/summary 消息通过 `sendSharedSessionTurnV2` 发送，会写入 canonical fact log（持久化）。Canvas 层通过以下机制剥离：

1. `filterMultiAgentCanvasItems` → `stripCollabInternalPrompt` 对 `[[mossx.collab.summary]]` marker 返回空字符串 → 整条 user 消息丢弃。
2. `isCollabInternalPromptText` + `[[mossx.collab.summary` 的 assistant 消息整段隐藏。
3. `COLLAB_BRIEFING_MARKER` / `COLLAB_SUMMARY_MARKER` 作为调度边界标记。

**修改 collabPrompt.ts 时必须同步更新 `SUMMARY_HIDE_HINTS` / `STRIP_FROM_HINTS`**，否则内部指令泄漏到用户可见时间线。

### 17.4 协作结束后的会话恢复

`buildCollabSummarySendText` 包含指令：

> 重要：此后用户消息均为普通编程对话，勿再以「协作调度者」身份接管会话。

配合 `collabRunActive` 在终态后自动变 `false` → `collabLocksComposer` 解除 → 用户可以正常发送普通 Shared Session 消息。

### 17.4.1 Runtime Context：AI 必须吃到子节点产出（2026-08-06）

**问题（非人眼 UI）**：人在右栏 Inspector 可看 stage 全文；但主幕 subsequent ordinary turn 若 Context Package 不含 stage 产出，模型会像「新会话」只剩 residual。

**合同（仅协作存在时生效；无协作 Shared 零变更）**：

1. stage 结算写 `squad.nodeOutcomeRecorded.outcome.body`（capped）+ short `summary`。
2. Context Compiler 将 nodeOutcome 投影为 portable assistant 文本（`[协作环节 {id} · {status}]`）。
3. **禁止** destination-owned / squad-worker attempt 过滤吞掉 nodeOutcome。
4. collab control briefing/summary user turn 可 omission，避免调度指令占 budget。
5. 取消 run 的已成功 stage partial body 仍进入后续 ordinary turn。

事实源：OpenSpec `fix-shared-collab-context-and-sidebar-spawn`；实现 `agent_orchestration/commands.rs`、`shared_context/compiler.rs`。

**实机验收（2026-08-06）**：协作成功后 ordinary turn 可正确复述 3 个 stage 职责与产物 → G1 成立。

### 17.4.2 协作右栏流式（P0 · 与主幕布同源）

**禁止** agent attempt 旁路只抠 `extractRealtimeTextDelta` → 纯文本 livePhase → 2.5s 轮询 projection。  
**必须**复用主幕布链路：

1. 各 CLI `RealtimeAdapter.mapEvent` + `routeNormalizedRealtimeEvent` / `onAgentMessageDelta`
2. `liveAssistantTextChannel` + `MessageRow` 流式正文
3. attempt 作用域 canvas thread id：`agent-canvas:{sharedThreadId}:{attemptId}`，**不进**主幕 `shared:` 时间线
4. Inspector `Messages` 的 `threadId` = canvas id，items 来自同一套 item 装配

事实源：`useAppServerEvents.dispatchAppServerEvent`、`threads/adapters/*`、`liveAssistantTextChannel.ts`。

### 17.4.3 Inspector 展示权威（防「头与幕布两套故事」）

**执行真相**（event log）：每 stage `begin_stage_turn(&stage.target)` + squad worker binding；本地核对 plan/claude、implement/codex、review/grok 分 binding **真实执行**。

**展示契约**（仅 UI）：

1. **头** = `stage.target` + 可选 `personaAgentName`（编排投影）。
2. **幕布正文** = 仅当前 `stage.attemptId` 的 live canvas，或 settle 时本 stage `fullOutcome`（**禁止**用 shared projection 整会话回填；**禁止**非 plan stage 使用 `plan.markdown`）。
3. **气泡徽章** = 强制对齐 `stage.target` 快照（`alignItemsToStageTarget`）；agent-canvas 查 activeTurn 时用 **shared:** key。
4. 头与徽章不一致视为展示 bug，不是「执行写错」的充分证据——对账以 `turnCommitted.target` / bindingKey 为准。

事实源：`useAgentStageTranscript.ts`、`useAppServerEvents.ts`（activeTurn thread key）、`shared-event-log-v2.sqlite3`。

### 17.5 Composer 锁定

运行中 `collabLocksComposer = collabRunActive` 完全锁定主输入区。终态自动恢复。

流式直播期间进度条使用 `useRef` 记录 `wasEverLive`，只升不降，避免阶段切换时 indeterminate ↔ determinate 动画闪烁。

---

## 18. 术语表

| 术语 | 含义 |
|------|------|
| Collaboration / 协作 | 本功能产品名；多引擎分环节编排 |
| Stage / 环节 | 管线上有序步骤，带独立 target |
| Execution Target | 引擎+供应商+模型等可冻结执行目标 |
| Control Plane | mossx 持有的调度与权威状态 |
| Worker Turn | 某 stage 在 CLI runtime 上的 ordinary turn |
| shortOutcome | 主时间线一行结果 |
| finalSummary | 给用户的短汇总 |
| Scoped Binding | 按 run+stage+target 隔离的 continuation owner |
| 原生子代理 | 引擎内部 Task/SubAgent，非 collab stage |
| Collab Pill | Composer 下方的协作开关按钮（仅 Shared Session 可见） |
| [[mossx.collab.*]] | Canvas 层隐藏的调度标记；模型正常接收，幕布不渲染 |

---

## 19. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-06 | Code Review 修复合集：featureFlag 默认 false（前端+Rust 双层）、mergeLiveText 防重复、进度条 wasEverLive 去闪烁、CSS GPU 加速、§17 边界安全新增 |
| 2026-08-05 | 首版：对齐「多引擎分环节编排」产品真相，纠正单 target 流水线与完成页 dump 误区 |
| 2026-08-05 | v4 预览稿定稿：右编排面板终局样式 = 07 节点卡片轮播（06 留作诊断向备选）；P2 修订为「右栏流式精读」；新增 P8 轮次规则；§8 全节按 v4 重写（双栏拖拽、composer 弹层入口、页内模板模态、四态旅程） |

---

## 20. 相关文档

- Shared / multi-CLI 基石：`docs/research/mossx-multi-cli-provider-session-foundation-design.md`
- 新 CLI 接入：`docs/research/mossx-new-cli-onboarding-guide.md`
- 渲染性能：`docs/perf/render-jank-knife-experiments-2026-07-08.md`
- 规则入口：`AGENTS.md`、`openspec/`

---

**结语**

多引擎编排的价值不在「再多跑几次模型」，而在 **把正确的引擎组合用在正确的环节**，并让用户 **始终看懂编排**。  
主幕布负责 **组合与状态**；分屏负责 **节点现场**；结束只留 **短汇总**。这是本设计的唯一北极星。
