---
type: architecture
status: active
---

<!-- DOC-LIFECYCLE: draft-architecture-design -->
> [!NOTE]
> **Lifecycle: Draft design（仅设计，未实施）**。UI 零改动；行为以落地后 OpenSpec + 代码为准。  
> 关联 UI：`ComposerRunStatusStrip`（朱昆鹏 2026-08-07）；关联基石：`docs/research/mossx-multi-cli-provider-session-foundation-design.md`；  
> 关联 change 草案：`openspec/changes/wire-shared-composer-run-status-strip/`（live fan-in 切片）、本文推荐的 durable 主路径待新 change。

# Session Side-Effect Ledger（会话副作用账本）

> 内容类型：Architecture Design（推荐实现 + 客户端切片已落地）  
> 日期：2026-08-08  
> 范围：Shared Session 普通模式 + multi-agent 协作 + **子代理侧栏父子树** + Composer「已编辑」  
> **硬约束：UI 组件零改**（Strip / 侧栏嵌套形态复用；不恢复幕布 SquadGrid）

## 与子代理统一

| 副作用 | 账本字段 | 消费面 |
|--------|----------|--------|
| 文件写入 | `fileEdits[]` | ComposerRunStatusStrip「已编辑」 |
| 子代理 spawn | `subagents[]` | 侧栏父子树 + Strip 子代理 pill 补充 |

二者同一 `SessionSideEffectRecord`（per threadId），禁止再靠「幕布合成 tool 卡」当 Shared 唯一事实源。

### 产品入口决策（2026-08-08 最终）

**S10 数据层恢复，UI 仍只在 Strip：**

| 层 | 策略 |
|----|------|
| 主幕布 | **不**画 SquadGrid；**不**往 Messages 注入合成卡 |
| 合成源 | 恢复 `enrichTimelineWithSyntheticSubagentsBeforeCollapse`（与旧 MessagesCore 同源） |
| 消费 | 合成 items → `useStatusPanelData` → `ComposerRunStatusStrip` 子代理 pill |
| 列表 hide | 保留 `parent=shared` 的子线程，供 `childSubagentThreads` |
| 已编辑 | Session File-Edit Ledger（独立，不混子代理侧栏折腾） |

---

## 一、问题陈述

### 1.1 用户看到的现象

输入框上方已有 **Run Status Strip**（「已编辑 N 个文件 + 撤销全部」等），Native 会话在 Agent 改文件后可出现该区域。  
在 **Shared CLI** 下：

| 场景 | 现状 |
|------|------|
| 普通 Shared（单引擎写文件） | 常看不到或不全（主线 tools 投影/边界依赖） |
| 协作 multi-agent | live 时靠 agent-canvas 勉强 fan-in；**历史/冷启动几乎必空** |
| 右侧 Git Diff 有文件 | 有；与 Strip **不是同一数据源** |

### 1.2 根因（架构）

当前「已编辑」完全由 **对话 items 扫描** 派生：

```text
items（主时间线）∪ agent-canvas live
  → buildTurnFileChangesByBoundaryId
  → mergeTurnFileChangesSummaries
  → ComposerRunStatusStrip
```

与业界（Cursor 等）的差异：

| | mossx 现状 | Cursor 类 |
|--|------------|-----------|
| 变更权威 | 聊天/canvas 上的 tool 气泡 | **会话级 Edit Ledger** |
| 协作写文件 | 隔离在 `agent-canvas:*`（不进主幕、**不落盘**） | 仍写入 **conversation 绑定的变更账本** |
| 历史打开 | canvas 空 + 主线无 tools → Strip 空 | 账本随会话恢复 → 列表仍在 |
| Git | 仅撤销用 git restore | Review 列表与 Git 并行，不是同一状态机 |

**结论**：只加厚 `collectRunStatusSourceItems` 扫 items，**无法**让历史可靠；必须引入 **durable 会话文件变更账本**。

### 1.3 非目标（本文明确不做）

- **不改 UI**：不改 pill 样式、布局、文案结构、展开交互、确认弹窗。
- 不在主幕 Messages 重放 worker 工具卡（保持协作主幕干净）。
- 不把 Git dirty 列表当作 Agent 变更的唯一真相（避免与用户手改混淆）。
- 不做 hunk 级 Accept/Reject（Cursor 编辑器审查能力，超出本切片）。

---

## 二、目标与成功标准

### 2.1 目标

1. **Shared 普通 + 协作** 在 **live 与历史** 下，只要本会话产生过可识别的 Agent 文件写入，输入框上方 **同一套**「已编辑」Strip 能出现。
2. 协作：变更从 **各节点 attempt 写文件事实** 归并到 **Shared 会话账本**，不要求主幕出现 tool 气泡。
3. 撤销继续走现网 `onRevertFile` / `onRevertAllFiles`（git restore），行为不变。
4. 根渲染隔离不变：禁止为 Strip 把全量 items 绑回 AppShell 空 props。

### 2.2 成功标准（可验收）

| # | 场景 | 通过标准 |
|---|------|----------|
| S1 | Shared 普通：模型写/改文件并结束 turn | Strip 出现已编辑；展开路径与 +/− 合理 |
| S2 | 协作：实现节点写文件（主幕无工具卡） | **不刷新**即可出 Strip；路径与节点写入一致 |
| S3 | 协作结束后 **冷启动 / 重开同一 shared 会话** | Strip **仍**显示该会话账本中的文件（历史可见） |
| S4 | 撤销全部 / 单文件撤销 | 二次确认后 git restore；列表乐观更新与现网一致 |
| S5 | 无 Agent 写文件 | Strip 不因 Git 脏文件单独出现 |
| S6 | UI | 与现网 Strip **像素级同组件**，无新控件 |

### 2.3 用户感受（完成后）

| 感受维度 | 期望 |
|----------|------|
| **可控** | 「Agent 动过哪些文件」一眼可见，不必翻右侧整仓 Git |
| **连贯** | 协作多节点写完后，主输入框上方仍是同一「已编辑」入口，不强迫进 Inspector 找 |
| **可恢复** | 关掉 App 再开同一会话，列表还在——像 Cursor 重开 chat 仍能 Review |
| **不吵** | 主聊仍干净；工具细节继续在节点幕布/Inspector |
| **安全** | 撤销仍要确认，不会 silently 丢改 |

用户**不应**感受到：

- 刷新后「改过的文件列表蒸发」  
- 协作与普通 Shared 两套完全不同的入口  
- 为了看改了啥必须理解 agent-canvas  

---

## 三、推荐实现方式（唯一主推）

### 3.1 一句话

> **建立 Session File-Edit Ledger（会话文件变更账本）作为 Strip「已编辑」的权威数据源；**  
> tool items / agent-canvas 仅作 **live 增量输入**；UI 继续消费现有 `TurnFileChangesSummary` 形状。

对齐 Cursor：**账本跟会话走，不跟 live 工具流寿命走**。

### 3.2 概念模型

```text
SharedSession (threadId = shared:<uuid>)
  └─ SessionFileEditLedger  (durable, 会话级)
        entries[]:
          path                 # workspace-relative 优先
          additions / deletions
          lastTouchAt
          sources[]:           # 可追溯，不直接画 UI
            - kind: "shared-turn" | "collab-stage"
            - turnId? / runId? / stageId? / attemptId?
            - toolItemId?
        schemaVersion
        updatedAt
```

**权威规则**：

- **展示 Strip**：只读 Ledger → 投影为 `TurnFileChangesSummary`（files + totalAdditions/Deletions）。  
- **写入 Ledger**：  
  - Shared 普通：从主线 settle 的 edit/fileChange tools **append/merge**  
  - 协作：从 stage worker 的 edit/fileChange（live canvas 或 stage settle 钩子）**append/merge**  
- **撤销**：UI 仍调 git restore；成功后从 Ledger **remove/mark restored** 对应 path（与现网乐观隐藏一致）。

### 3.3 为何不选其它方案

| 方案 | 否决原因 |
|------|----------|
| 仅加强 items 扫描 | 历史无 canvas、协作主线无 tools → 结构性不可达 |
| 仅用 Git status | 混入用户手改；无会话边界；与「本会话 Agent 改动」语义不符 |
| 历史重放全部 worker tools 进主线 | 破坏主幕干净叙事；体量大；与 nested-only 冲突 |
| 改 Strip UI 加「历史专用」入口 | 违反「UI 不改」；增加认知负担 |

### 3.4 分层与数据流（推荐）

```text
                    ┌─────────────────────────────┐
  Live tool events  │  Shared 主线 / agent-canvas  │
  (fileChange/edit) └─────────────┬───────────────┘
                                  │ append/merge (path 聚合)
                                  ▼
                    ┌─────────────────────────────┐
                    │  SessionFileEditLedger      │  ← durable（见 §4）
                    │  (per shared threadId)      │
                    └─────────────┬───────────────┘
                                  │ project → TurnFileChangesSummary
                                  ▼
                    ┌─────────────────────────────┐
                    │  Composer sessionFileChanges│  ← 现有 prop，形状不变
                    │  ComposerRunStatusStrip     │  ← UI 零改
                    └─────────────────────────────┘
```

**冷启动**：

```text
打开 shared 会话
  → 加载 Ledger（与 history 同生命周期）
  → 直接喂 sessionFileChanges
  → Strip 立刻可显（无需等 tool items 回放）
```

**Live**：

```text
工具完成写文件
  → 更新 Ledger（增量）
  → sessionFileChanges 引用更新
  → Strip 与现网一样亮起
```

---

## 四、持久化与投影（实现选型）

### 4.1 推荐落点（按优先级）

| 优先级 | 落点 | 说明 |
|--------|------|------|
| **P0 推荐** | Shared event log **旁路 fact** 或 `extra` 上的 durable 投影字段 | 与 Shared 会话同命运；历史加载自然带回 |
| P1 | 工作区 sidecar JSON：`~/.ccgui/.../session-file-edits/{threadId}.json` | 实现快；需保证删会话时 GC |
| 不推荐 | 仅 React 内存 / 仅 localStorage | 多窗口与冷启动弱 |

**推荐 P0 细节（倾向）**：

- 新增或复用一类 **SessionFileEditsUpserted**（名称可调整）canonical fact：  
  - `threadId`, `updatedAt`, `entries[]`（path + additions + deletions + sources 摘要）  
- 或在现有 turn settle / collab `nodeOutcomeRecorded` 路径 **增量 merge** 进会话级 projection 字段 `fileEditLedger`。  
- FE `sharedHistoryLoader` / 会话打开路径 **hydrate** 到轻量 store：`sessionFileEditStore[threadId]`。

具体 fact 名与表结构在 **实施 OpenSpec** 里定稿；本文锁定 **「会话级 durable + 可投影为 TurnFileChangesSummary」** 即可。

### 4.2 写入时机（协作）

| 事件 | 动作 |
|------|------|
| 协作 stage worker 产生 completed edit/fileChange（canvas 或 attempt 工具完成） | merge path 进 Ledger，`source.kind=collab-stage` + runId/stageId/attemptId |
| 主 Shared 普通 turn 的 edit tools 完成 | merge，`source.kind=shared-turn` + turn/item id |
| 用户撤销成功 | 移除 path 或清零统计并标记 restored |
| 新一轮协作 run（可选策略） | **默认累计本会话**（Cursor 也是会话累计）；若产品要「仅本 run」可加 `scope=runId` 过滤，**默认不做** |

### 4.3 与现有 `collectRunStatusSourceItems` 的关系

| 阶段 | 策略 |
|------|------|
| **Ledger 落地前（过渡）** | live 可继续 items fan-in（已有切片），**仅**补 live |
| **Ledger 落地后（目标）** | `sessionFileChanges` **优先读 Ledger**；items 扫描降级为 live 加速或校验 |
| **禁止** | 把 canvas 全量塞进 `useStatusPanelData`（已验证会污染主幕体验） |

### 4.4 投影到 UI 的适配层（无 UI 改动）

```ts
// 伪代码：形状必须兼容现网
function ledgerToTurnFileChangesSummary(ledger): TurnFileChangesSummary | null {
  // files: { path, additions, deletions, status: "completed" }[]
  // totalAdditions / totalDeletions
  // files.length === 0 → null  （Strip 不展示）
}
```

Composer 仅改为：

```ts
sessionFileChanges =
  ledgerSummary(threadId) ?? itemsDerivedSummary(...)  // 过渡期双读
```

**`ComposerRunStatusStrip` / `TurnFilesChangedCard` 不改 props 语义、不改布局。**

---

## 五、协作多节点：如何「从节点拿到变更」

### 5.1 不推荐

- 历史时去「重放每个节点 fullOutcome 里猜路径」  
- 要求主幕插入每个 Write 工具卡  

### 5.2 推荐

在 **工具完成写盘的当下**（与 attempt/canvas 同源事件）写入 Ledger：

```text
stage implement 写 Watermelon.java
  → tool completed (agent-canvas 或 worker binding)
  → SessionFileEditLedger.merge({
       path: "…/Watermelon.java",
       additions, deletions,
       source: { kind: "collab-stage", runId, stageId: "implement", attemptId }
     })
```

节点 Inspector 继续用 canvas 看过程；**Composer 只看 Ledger 聚合**。

若某些引擎只给 body 不给结构化 path：允许该次 merge 失败并记 diagnostics，**不强行用 git 猜**。

---

## 六、完成后表现（按场景剧本）

### 6.1 Shared 普通 · 新对话

1. 用户发「加一个接口」→ 模型改 3 个文件。  
2. **表现**：输入框上方出现现网同款「已编辑 3 个文件 +xx -yy」。  
3. 展开：文件列表；点路径开 Diff；撤销全部要确认。  
4. **感受**：「改动收口在输入框上，和 Native 一样。」

### 6.2 协作 · live

1. 大纲 → 实现（写多个文件）→ 审查。  
2. **表现**：实现段一旦有完成的写文件，Strip 开始累计；主幕仍可只有用户句 + 编排卡/汇总，**不必**出现工具瀑布。  
3. **感受**：「多节点在干活，但我在主输入框就能盯改了哪些文件。」

### 6.3 协作 · 历史（核心缺口补齐后）

1. 关掉 App，再打开同一 Shared 会话。  
2. **表现**：Strip 仍显示账本中的文件列表（与结束时一致或按撤销后更新）。  
3. **感受**：「昨天协作改的东西今天还能点开看/撤销（若 git 仍可 restore）。」  

### 6.4 无 Agent 写文件

- 仅用户本地改文件 → **Strip 不出现**（Git 面板仍可有）。  
- **感受**：「不会把 Git 脏状态误当成 AI 会话成果。」

---

## 七、与 UI 的契约（冻结）

| 组件 | 契约 |
|------|------|
| `ComposerRunStatusStrip` | 继续吃 `sessionFileChanges: TurnFileChangesSummary \| null` |
| `TurnFilesChangedCard` | 继续吃 summary + onRevert* |
| pill 文案 / 展开 / 确认 | **不改** |
| 主幕 Messages / HistoryFold / Inspector | **不因本设计改布局** |

实现者只允许改：**数据生产与 Composer 的 sessionFileChanges 赋值路径**。

---

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| Ledger 与磁盘 git 不一致 | 展示以 Ledger 为准；撤销失败 toast；可选「与磁盘核对」后续再做 |
| 路径绝对/相对混乱 | 写入时 normalize 为 workspace-relative |
| 账本膨胀 | 只存 path + 行统计 + 轻量 source；不存整文件 patch |
| 误把 canvas 塞进 statusPanel | 规范禁止；code review 门禁 |
| 旧会话无账本 | 历史会话 Strip 仍可空；新会话起生效；可选 backfill 不做 V1 |

---

## 九、实施切片建议（实现阶段再用）

| 切片 | 内容 | 验收 |
|------|------|------|
| **M1** | Ledger 存储 + hydrate + Composer 优先读 Ledger | S3 历史可见（新会话产生的账本） |
| **M2** | Shared 普通 turn 写工具 → merge Ledger | S1 |
| **M3** | 协作 stage 写工具 → merge Ledger | S2 + S3 |
| **M4** | 撤销成功回写 Ledger；测试与基石校准行 | S4 |

OpenSpec：新建 change（建议 id：`add-session-file-edit-ledger`），**不要**把 durable 账本塞进仅 live fan-in 的旧 change 而不分阶段。

现有 `wire-shared-composer-run-status-strip` 仅作 **live 过渡**；M1 落地后降级为 Ledger 的 live 加速可选层。

---

## 十、对基石文档的回写点（实施时）

在 `mossx-multi-cli-provider-session-foundation-design.md`「零、当前实现校准」保留/升级一行：

| 契约面 | 目标事实 | 事实源 |
|--------|----------|--------|
| Composer 已编辑权威 | **Session File-Edit Ledger**（会话级 durable）；items/canvas 仅 live 输入 | 本文 + OpenSpec `add-session-file-edit-ledger`（待建） |

更新触发器增加：**session file-edit ledger schema / 写入时机**。

---

## 十一、总结

| 问 | 答 |
|----|-----|
| 推荐实现？ | **会话级 File-Edit Ledger（durable）**，投影为现有 `TurnFileChangesSummary` |
| 完成后什么样？ | 普通/协作、live/历史，同一 Strip 能列 Agent 改过的文件并撤销 |
| 用户感受？ | 可控、可恢复、主聊不吵；刷新不再「改动列表蒸发」 |
| UI？ | **零改动**，只换数据源权威 |

**先设计后实现**：本文冻结方向；实现时以 OpenSpec change 拆 M1–M4，禁止再次用「只扫 transcript」冒充历史能力。
