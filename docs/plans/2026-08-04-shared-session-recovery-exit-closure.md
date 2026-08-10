---
type: plan
status: implemented
---

<!-- DOC-LIFECYCLE: implemented-pending-user-review -->
> [!IMPORTANT]
> **Lifecycle: Implemented, pending user review (no git commit).**  
> OpenSpec change：`openspec/changes/fix-shared-session-recovery-exit-closure/`。  
> 上游权威设计：`docs/research/mossx-multi-cli-provider-session-foundation-design.md` §14.5 / §14.5.7。  
> 实现事实源：`src-tauri/src/shared_session_v2.rs`、`SharedSendStatusBar.tsx`、`sendSharedSessionTurnV2.ts`。

# Shared Session 恢复出口闭环计划（Recovery Exit Closure）

| 字段 | 值 |
|------|-----|
| **日期** | 2026-08-04 |
| **状态** | Draft · 待确认后 OpenSpec 化 |
| **优先级** | P0（可用性 / 采用率） |
| **平台** | **跨平台**（macOS / Linux / Windows 同一状态机；非 Win-only） |
| **触发** | 社区反馈：切换目标失败锁死整条 Shared；点「重建」无限「需要恢复」；2h 内多条会话被锁；融合在网关不可达时不可用；另附归档/拖拽体验债 |
| **一句话目标** | **保留 fail-closed 防双发，补齐可完成的恢复出口，使 Shared 会话不再变成消耗品。** |
| **基石文档** | [`docs/research/mossx-multi-cli-provider-session-foundation-design.md`](../research/mossx-multi-cli-provider-session-foundation-design.md)（下称**基石**） |
| **设计补丁** | 基石 **§14.5.7**（2026-08-04 初稿 + **同日校准**）；实现仍待本 plan / OpenSpec |
| **校准原则** | 不推翻 §14.5.1–14.5.6；对齐术语 / 状态边 / 迟到证据 / disposition→按钮 |

---

## 0.A 基石对照：实现遗漏 vs 设计缺失

> 对照与校准日：2026-08-04。基石：§8.4、§14.2.3、§14.5、§14.5.7、红线 27/40/49–53。

| 议题 | 基石（补丁前） | 判定 | 处置 |
|------|----------------|------|------|
| recovery 锁整会话 | §14.5.3 已规定 | **设计已有 · 保留** | 不改合同 |
| target-unavailable 与 recovery 分态 | §14.5.3 / §8.4 已分 | **设计已有**；若线上混用 → **实现分类遗漏** | Wave 1 纠偏代码 |
| Probe 先于 Retry / 禁 blind retry | §14.5.5、红线 27 | **设计已有 · 实现大体有** | 保持 |
| 显式 Rebuild Binding | §14.5.5 | **设计已有 · 命令已有** | 保持；前置条件见 §14.5.7.4 |
| Rebuild 时 Runtime own → 须先 Stop | **未写清**；代码已 fail-closed 拒绝 | **设计缺失 + 实现出口遗漏** | §14.5.7 已补；Wave 2 |
| recovery 用户动作仅 Probe+重建 | §14.5.3 动作列过窄 | **设计过窄** | §14.5.7 扩展动作 |
| durable 放弃本轮 Abandon | **未写**；impact report §9.1.4 | **设计缺失** | §14.5.7.5；Wave 2 |
| 可完成出口（≠ fail-open） | 原则分散 | **原则补丁** | 红线 50–53 |
| 术语混用 Probe/Recover/Stop/Abandon/Rebuild | 分散 | **校准补齐** | §14.5.7.1 |
| RecoveryRequired→Idle 跳边 | 易误写 | **校准** | 必须经 Settling 或 reattach Running |
| 迟到 ACK after Abandon/Rebuild | **未写** | **校准补齐** | §14.5.7.5；测试必测 |
| attempt vs binding owner | 实现有、设计弱 | **校准补齐** | §14.5.7.1 |
| disposition→按钮矩阵 | **未写** | **校准补齐** | §14.5.7.3 |
| interrupt 能力缺失时的出口 | **未写清** | **校准补齐** | §14.5.7.6 |

**结论（给评审用）：**

1. **不是**「基石完全没设计 recovery」——锁、分态、Probe、禁 blind retry、Rebuild 语义都有。  
2. **是**「出口阶梯写窄了」——Stop-before-rebuild、Abandon、错误映射属 **设计补丁**。  
3. **另有** 可能的 **实现分类遗漏**（unavailable 抬升为 recovery）。  
4. 后端 `recovery-active` 拒绝 Rebuild **符合** fail-closed；坏在 **下一步未定义**。  
5. 二次 review 校准：术语、状态边、迟到证据、owner 种类、按钮启用——**不推翻**既有九态与线性锁。

---

## 0. 问题陈述

### 0.1 用户可见症状

| ID | 症状 | 用户原话/证据 | 严重度 |
|----|------|---------------|--------|
| S1 | 目标渠道不可用时整条 Shared 被锁 | 「切换时目标渠道不可用就会立刻失败并锁死整个会话」 | P0 |
| S2 | 「重建会话连接」无效，无限停留「需要恢复」 | 错误：`recovery-active: attempt … is still owned by Runtime; Probe/Stop before rebuild` | P0 |
| S3 | 短时间多条 Shared 积压锁死 | 「2 小时被锁的 share 会话已经 5 个」 | P0（S1+S2 后果） |
| S4 | Share 会话「融合」不可用 | UI：「网关不可达」 | P1 |
| S5 | 工作区缺项目归档 | 产品建议 | P2 |
| S6 | 窗口长按拖动热区过小 | 产品建议 | P2 |

### 0.2 工程定性（已核对源码）

| 结论 | 依据 |
|------|------|
| **S1/S2/S3 不是 Win 特有** | `shared_session_v2_rebuild_binding`、`sendStateMachine`、`SharedSendStatusBar` 无 OS 分支 |
| **锁 `recovery-required` 部分是设计意图** | 上游 §14.5.3：ambiguous Turn 锁整会话，防 Context boundary 乱序 |
| **目标不可用应走 `target-unavailable`，不该等价于 recovery** | §14.5.3：`target-unavailable` 时 Picker 可换、Send disabled |
| **Rebuild 硬门禁正确，UI 出口不闭环** | Runtime `owns_attempt` 时 rebuild 拒绝；前端 rebuild 不先 Stop/Interrupt；失败后状态仍 `recovery-required` |
| **已有 interrupt 能力未接到 recovery 出口** | `shared_session_v2_interrupt_turn` 已存在；rebuild 路径只提示 “Probe/Stop before rebuild” |
| **S4 是前置条件问题** | 网关不可达时禁用融合合理；需更清晰可操作文案，避免误判为 Shared 专属坏了 |
| **S5/S6 与 recovery 解耦** | 单独 backlog，不进本 change 的 P0 范围 |

### 0.3 根因分层

```text
L1 现象：会话锁死 + 重建死循环 + 采用率下降
        │
L2 机制：
  A. 失败分类过粗 —— 部分 “target 不可用 / begin 早退” 被抬成 recovery-required
  B. 恢复动作不完整 —— Rebuild 要求 Runtime 已释放，但 UI 不执行 Stop/Interrupt
  C. 无明确放弃出口 —— held/unknown 后只能反复 Probe/Rebuild toast，不能 “放弃本轮并解锁”
  D. 文案与按钮顺序误导 —— 用户先点重建（更像“救命”），触发硬拒绝
        │
L3 原则冲突：
  Fail-closed（防重复投递） 已实现
  Completable exit（可完成出口，≠ fail-open 放行）缺失  →  安全变成拒用
```

### 0.4 明确不改的边界（Non-Goals）

1. **不取消** `recovery-required` 对 ambiguous Turn 的整会话锁定（上游线性顺序合同保留）。
2. **不自动 blind retry / 不自动换 Target failover**（§14.5.5）。
3. **不在本计划引入** Queue/Branch 以支持 “recovery 中切其他 Binding 继续聊”（属更大 redesign）。
4. **不重做** Shared 历史 projection / Native recovery 卡片边界（R.13 已完成）。
5. **不把** S5 项目归档、S6 标题栏拖拽并进本 P0 change（见 §8 Backlog）。

---

## 1. 目标与成功标准

### 1.1 产品目标

| 目标 | 可测定义 |
|------|----------|
| G1 分类正确 | 纯 target 不可用 → `target-unavailable`，用户可换 Target 后发送；**不**进入整会话 recovery 锁 |
| G2 恢复可完成 | 从 `recovery-required` 出发，用户经 **有限步（≤3 次明确点击）** 必达：`idle` 或 `running(reattach)`，无无限循环 |
| G3 不双发 | 任意恢复路径不产生第二个同序 Turn / 不盲建第二个 Binding |
| G4 可解释 | 错误文案说明 **为何锁、下一步点谁、点了会发生什么**；禁止只抛 raw `recovery-active:…` |
| G5 跨平台一致 | mac / linux / win 同一契约；验证矩阵三端至少各跑主路径一次（或 CI + 一端实机 + 文档化等价条件） |

### 1.2 反目标（防止“修坏”）

- 禁止 “一键解锁且不落盘 cancel/terminal evidence” 的静默 idle。
- 禁止 rebuild 在 Runtime 仍 own attempt 时强行 archive（双发风险）。
- 禁止把 gateway 不可达伪装成 “融合功能未实现”。

---

## 2. 方案总览（分波交付）

```text
Wave 0  证据固化（复现脚本 + 分类矩阵）     不改行为，只钉事实
Wave 1  分类纠偏（S1）                       target-unavailable vs recovery
Wave 2  恢复出口闭环（S2/S3）               Probe → Stop → Rebuild / Abandon（含迟到证据）
Wave 3  可观测与文案（G4）                   i18n + 技术详情折叠
Wave 4  融合/网关降级体验（S4）             明确禁用原因与修复动作
──── 本计划主交付 ────
Wave B  Backlog：归档（S5）、拖拽热区（S6）  独立 change
```

**建议首个 OpenSpec change 范围：Wave 0–3（P0）。** Wave 4 可同 change 小改或 follow-up。

---

## 3. 目标行为设计（To-Be Contract）

> **权威细节以基石 §14.5.7 为准**；本节是实施摘要，避免与 ADR 分叉。

### 3.0 术语（实施时禁止混用）

| 用户文案 | 工程动作 | 命令 |
|----------|----------|------|
| 检查状态 | Probe Binding ± Recover Attempt | `probe_binding` / `recover_attempt` |
| 停止投递 | Interrupt owner attempt | `interrupt_turn` |
| 重建会话连接 / 停止并重建 | 条件满足后 Rebuild Binding | `rebuild_binding`（可先 interrupt） |
| 放弃本轮 | durable Abandon Turn | 拟 `abandon_unresolved_attempt` |

**Stop 成功 ≠ 回 idle**；必须再 Probe/Abandon/Rebuild 做 durable 结算。  
**禁止** `recovery-required` 直接跳 `idle`（须 `settling` 或 reattach `running`）。

### 3.1 失败分类矩阵（核心）

| 场景 | 现有风险 | To-Be 状态 | Composer | Picker | 用户下一步 |
|------|----------|------------|----------|--------|------------|
| Provider 删除 / 配置无效 / runtime 明确不可达，且 **无 unresolved attempt / 无 recovery binding** | 可能误进 recovery | **`target-unavailable`** | Send disabled | **可换** | 换 Target / 修配置 |
| begin 返回 `target-unavailable` | 已有路径 | 保持 | 同上 | 可换 | 同上 |
| begin/ACK **ambiguous** 或 in-flight attempt 未定性 | 正确进 recovery | **`recovery-required`** | 锁定 | 锁定 | 见 3.2 |
| binding provisioning recovery-required（无 in-flight attempt） | 易与 turn recovery 混 | **`recovery-required`**（owner=`binding`） | 锁定 | 锁定 | Probe → Rebuild |
| connectionLost / binding-recovery-required | 正确进 recovery | 保持 | 锁定 | 锁定 | 见 3.2 |
| gateway 全局不可达（无 attempt） | 体验模糊 | **不锁 recovery** | 按现有 gateway gate | — | 恢复网关 |

**验收铁律：**  
“目标渠道不可用” alone 不得导致 `recovery-required`。

### 3.2 恢复状态出口（与 §14.5.7.3 对齐）

```text
推荐心智顺序（非强制唯一路径）:
  检查状态 →（仍 own）停止投递 → 重建 或 放弃本轮

状态边（校准）:
  recovery-required --Stop--> recovery-required   (仅 runtimeReleased 细节)
  recovery-required --Probe/Recover active--> running
  recovery-required --Probe terminal/not-accepted|Abandon|Rebuild settle--> settling --> idle
  禁止: recovery-required --> idle（跳过 settling）
```

#### 3.2.1 动作语义与启用条件

完整 disposition→按钮矩阵见基石 **§14.5.7.3**。摘要：

| 动作 | 后端 | 成功后状态 | 失败后 |
|------|------|------------|--------|
| 检查状态 | probe ± recover | running / settling→idle / held | held；不自动 rebuild |
| 停止投递 | interrupt_turn | **仍 recovery-required** | 说明 + 引导放弃 |
| 重建 | rebuild_binding | settling→idle | recovery-active→引导停止并重建 |
| 放弃本轮 | abandon durable | settling→idle；重启不复活 | ambiguous fail closed |

**Abandon 约束：** 显式确认；durable；active 时强警告；禁止 multi-owner 一键清空。  
**Rebuild vs Abandon：** attempt 未决但 binding 健康 → 优先结算/Abandon；binding 损坏才 Rebuild。

#### 3.2.2 Rebuild 产品策略

| 策略 | 描述 | 建议 |
|------|------|------|
| A. 纯引导 | 失败 toast 请先停止 | 过渡 |
| B. 内联 Stop 再 Rebuild | own 时自动先 interrupt | **默认** |
| C. 按钮分离 | Rebuild disabled until !owns | 呈现层可并用 |

**推荐：B + 文案「停止并重建」。** A 不作为最终验收。

#### 3.2.3 迟到证据（实施必测）

| 时序 | 期望 |
|------|------|
| Abandon 后迟到 ACK/terminal | 不双发、不矛盾 double commit、不重锁同一 attempt |
| Rebuild 后旧 native 迟到事件 | 不写入新 binding live turn |
| Stop 后迟到 terminal | Probe 应能 terminal→settling（优于强迫 Abandon） |

### 3.3 与上游 §14.5 的兼容说明

| 上游要求 | 本计划态度 |
|----------|------------|
| ambiguous 锁整会话 | **保留** |
| 禁止 blind retry | **保留** |
| Rebuild = 归档 Binding + 新 Native，identity 不变 | **保留** + §14.5.7 前置 |
| Probe Binding 不改 runtime | **保留**；Recover/Stop/Abandon/Rebuild 分域 |
| App 重启恢复 recovery | **保留**；仅 durable unresolved 时；Abandon 后不复活 |
| 九态状态机 | **不新增状态名**；复用既有 transition 事件 |
| 可完成出口 | **补齐**（红线 50–53）；≠ fail-open |

---

## 4. 实现架构

### 4.1 触点地图

| 层 | 路径 | 改动性质 |
|----|------|----------|
| UI | `src/features/shared-session/components/SharedSendStatusBar.tsx` | 阶梯按钮、loading、确认对话框、错误映射 |
| 状态机 | `src/features/shared-session/target/sendStateMachine.ts` + `sharedSendStateStore.ts` | 事件是否扩展（尽量不扩状态枚举；用 detail/flags） |
| 发送入口 | `sendSharedSessionTurnV2.ts` | 早退分类审计；禁止误 `ackAmbiguous` |
| RPC 封装 | `src/features/shared-session/services/sharedSessions.ts` | interrupt / abandon API 绑定 |
| Backend | `src-tauri/src/shared_session_v2.rs` | abandon 命令或 recover 扩展；rebuild 错误码结构化 |
| Runtime | `shared_runtime_coordinator.rs` | 仅在既有 remove/owns 契约上组合，避免新所有权模型 |
| i18n | `src/i18n/locales/*/sharedSend.ts` | 全语言补齐（至少 zh + en） |
| 测试 | `SharedSendStatusBar` / `sendSharedSessionTurnV2` / Rust recovery-active tests | 行为锁 |

### 4.2 建议 API 形状（确认后冻结）

**优先复用，少造命令：**

```text
已有：
  shared_session_v2_probe_binding
  shared_session_v2_recover_attempt
  shared_session_v2_rebuild_binding
  shared_session_v2_interrupt_turn

拟新增（仅当组合不够）：
  shared_session_v2_abandon_unresolved_attempt
    in:  workspaceId, threadId, attemptId?, bindingKey?
    out: { status: "cancelled-committed" | "rejected-ambiguous" | "rejected-active-requires-stop", ... }
```

**错误结构化（rebuild/interrupt）：**

```json
{
  "code": "recovery-active",
  "attemptId": "...",
  "hint": "stop-before-rebuild",
  "message": "human readable"
}
```

前端按 `code` 分支，不再依赖英文字符串 startsWith 作为唯一契约（可兼容旧 message 过渡一期）。

### 4.3 前端控制流（伪代码）

```text
handleStopAndRebuild:
  set working
  owner = findRecoveryOwner()
  if clear → unlock; return
  if ambiguous → held + detail; return
  try interrupt(owner.attemptId)   // best-effort; record result
  try rebuild(owner.bindingKey)
  on success → commitCancelled + canonicalCommitted → idle
  on recovery-active → held + CTA “仍被 Runtime 持有，请重试停止或放弃本轮”
  on other → held + mapped error

handleAbandon:
  confirm dialog (active 时强警告)
  abandon RPC (durable cancel)
  → commitCancelled/probeNotAccepted + canonicalCommitted 经 settling
  禁止 setState(idle) 直跳

迟到事件:
  若 attempt 已 terminal committed → absorb/diagnostic only
```

### 4.4 状态机实现约束

- **不** 扩展 `SharedSendState` 九态。
- Abandon/Rebuild 成功只 dispatch 既有：`commitCancelled` | `probeNotAccepted` | `probeTerminalRun` + `canonicalCommitted` / `terminalCommitted`。
- Stop 成功可用 store `detail`/`flags.runtimeReleased`，状态保持 `recovery-required`。
- `isPickerLocked` / `isComposerInputLocked` 行为与基石一致：recovery 仍锁输入与 picker。

---

## 5. 分波任务清单

### Wave 0 — 证据固化（0.5–1d）

| Task | 内容 | 产出 | 验收 |
|------|------|------|------|
| W0.1 | 复现矩阵：纯 target 不可用 / ACK ambiguous / Runtime own + rebuild / gateway down | `docs` 小节或 OpenSpec verification 初稿 | 每条有「期望状态 + 实际状态」 |
| W0.2 | 代码路径标注：哪些 dispatch 进 `ackAmbiguous` / `targetUnavailable` | 表格式附录 | 覆盖 begin 早退、prepare 失败、connectionLost |
| W0.3 | 确认 interrupt 在 recovery 中的可用性与权限 | 笔记 | 列出发动机差异（Claude/Codex/…） |

### Wave 1 — 分类纠偏 S1（1–2d）

| Task | 内容 | 主要文件 | 验收 |
|------|------|----------|------|
| W1.1 | 审计 `sendSharedSessionTurnV2`：仅真正 ambiguous 才 `ackAmbiguous` | `sendSharedSessionTurnV2.ts` | 单测：target-unavailable begin → state=`target-unavailable`，且可换 target 后发送 |
| W1.2 | 审计 backend `begin_turn` 返回 status 与 reason 映射 | `shared_session_v2.rs` | 契约测试：无 unresolved 时 provider missing ≠ recovery-required |
| W1.3 | UI：`target-unavailable` 展示可操作原因 + 引导换 Target | `SharedSendStatusBar.tsx` | 组件测 / 故事级手动 |

### Wave 2 — 恢复出口闭环 S2/S3（2–3d）

| Task | 内容 | 主要文件 | 验收 |
|------|------|----------|------|
| W2.1 | Recovery UI：检查/停止/停止并重建/放弃；按 disposition 启用 | `SharedSendStatusBar.tsx` | 对齐 §14.5.7.3 矩阵；busy 防双击 |
| W2.2 | Rebuild：own 时先 interrupt（策略 B）；Stop 后仍 recovery 直至 settle | FE + BE | 无无限 toast 死循环；无直跳 idle |
| W2.3 | Abandon durable + 幂等 | BE + FE confirm | 重启不复活同一 attempt 锁 |
| W2.4 | 迟到 ACK/terminal after Abandon·Rebuild | FE/BE tests | 不双发、不重锁、不写入错误 binding |
| W2.5 | `recovery-active` 结构化错误 + i18n | BE + i18n | 可操作中文步骤 |
| W2.6 | interrupt capability=none 时禁用 Stop，Abandon 为主出口 | FE + capability | 不假装 Stop 成功 |
| W2.7 | Rust：owns 拒绝 rebuild；interrupt 后 rebuild；abandon 幂等 | `shared_session_v2` tests | cargo test 绿 |

### Wave 3 — 可观测与文案 G4（0.5–1d）

| Task | 内容 | 验收 |
|------|------|------|
| W3.1 | recoveryHint 按 disposition 分化（active / unknown / not-accepted） | 文案表评审通过 |
| W3.2 | 技术详情可折叠（attemptId / bindingKey）供支持排障 | 默认不吓普通用户 |
| W3.3 | 埋点或 debug log（可选）：recovery enter/exit reason | 至少 dev log 有 attemptId |

### Wave 4 — 融合/网关 S4（0.5d，可 follow-up）

| Task | 内容 | 验收 |
|------|------|------|
| W4.1 | 网关不可达时融合按钮 disabled 原因统一文案 | 不出现“点了没反应” |
| W4.2 | 与 recovery 并存时优先级：先恢复网关/会话，再谈融合 | 手动场景 1 条 |

---

## 6. 测试与验证矩阵

### 6.1 自动化（合并门禁最低集）

| 层级 | 用例 | 期望 |
|------|------|------|
| FE unit | begin `target-unavailable` | 不进入 recovery-required |
| FE unit | recovery + rebuild while owned | 触发 stop-then-rebuild 或可操作错误，状态不 silent idle |
| FE unit | abandon success | → idle 且 dispatch 顺序正确 |
| Rust | rebuild while owns_attempt | Err `recovery-active`（或 structured code） |
| Rust | interrupt/remove then rebuild | Ok prepared |
| Rust | abandon commits cancel evidence | durable 可读；重启后无 unresolved |

### 6.2 手动（跨平台）

| ID | 步骤 | mac | linux | win | 期望 |
|----|------|-----|-------|-----|------|
| MT1 | Shared 选无效/停用 Provider 发送 | ☐ | ☐ | ☐ | target-unavailable，可换 Provider |
| MT2 | 发送中强杀 CLI / 断网制造 ambiguous | ☐ | ☐ | ☐ | recovery-required，无双会话 |
| MT3 | recovery 下「停止并重建」 | ☐ | ☐ | ☐ | ≤3 步经 settling 回 idle 或 reattach running |
| MT4 | recovery 下「放弃本轮」后重启 App | ☐ | ☐ | ☐ | idle，不复活锁 |
| MT5 | Abandon 后模拟迟到 ACK（或日志注入） | ☐ | ☐ | ☐ | 不双发、不重锁 |
| MT6 | 仅 Stop 成功 | ☐ | ☐ | ☐ | 仍 recovery-required，可再 Probe/Rebuild |
| MT7 | 关 gateway 看融合 | ☐ | ☐ | ☐ | 明确不可达，非死按钮 |

### 6.3 回归红线

- 正常 Shared 交叉切换（Claude↔Codex）不回归。
- 合法空 Shared 仍可 loaded。
- 不出现 Sidebar 双 Shared row / Hidden Binding 泄漏。
- 不把 Shared recovery 画成 Native「当前会话需要恢复」卡片。

---

## 7. 风险、回滚与发布

| 风险 | 影响 | 缓解 |
|------|------|------|
| Abandon 误杀真实在跑的 turn | 用户丢回答 | 确认框 + active 时强警告 + 优先 Stop |
| Interrupt 能力引擎不一致 | 部分引擎 Stop 失败 | 按 engine capability 禁用或降级 Abandon 文案 |
| 分类纠偏过宽导致该锁不锁 | 双发 / 乱序 | Wave 1 以单测钉边界；ambiguous 维持 lock |
| 结构化错误破坏旧客户端 | 兼容 | 一期 message 字符串保留，code 并行 |

**回滚：**  
功能可用 flag（如 `sharedRecoveryExitV2`，默认 on）包住新 UI 动作；关 flag 回退到旧 Probe/Rebuild 双按钮（已知缺陷可接受为紧急回滚）。

**发布建议：**  
先内测包验证 MT1–MT4，再进正式版；CHANGELOG 用户向描述：

> Shared 会话：目标不可用时不再误锁整会话；恢复支持停止投递与放弃本轮，避免重建死循环。

---

## 8. 明确拆出的 Backlog（不进本 P0）

| ID | 项 | 建议归属 |
|----|-----|----------|
| S5 | 工作区项目归档 | 独立 product change（会话/项目管理） |
| S6 | 标题栏拖拽热区扩大 | 独立 shell/UX change（`app-region: drag` 热区审计，三端） |
| F1 | recovery 中按 Binding 放行其他 Target | 需 Queue/Branch contract，上游明确 post-V1 |
| F2 | recovery 管理面（列表所有 locked Shared 一键治理） | Session management 增强 |

---

## 9. 执行顺序与预估

| 阶段 | 预估 | 依赖 |
|------|------|------|
| 确认本 PLAN + 开 OpenSpec change | 0.5d | 产品/owner 拍板 Abandon 与 Stop并重建 |
| Wave 0 | 0.5–1d | — |
| Wave 1 | 1–2d | W0 |
| Wave 2 | 2–3d | W1 分类稳定 |
| Wave 3 | 0.5–1d | W2 UI 文案位 |
| Wave 4（可选） | 0.5d | — |
| 验证 + 修回归 | 1d | — |
| **合计（P0）** | **约 5–8 人日** | 单人串行口径 |

---

## 10. 决策清单（确认后才能落代码）

请 owner 确认：

1. **Rebuild 策略**：采用推荐 **B（停止并重建）**，还是 C（按钮严格分离）？
2. **Abandon 是否进 P0**：建议 **是**（否则 unknown/interrupt 失败仍可能积压锁死）。
3. **OpenSpec change-id**：建议 `fix-shared-session-recovery-exit-closure`。
4. **Feature flag**：是否需要（建议要，默认开）。
5. **S4 网关融合文案**：并进本 change 还是 follow-up？
6. **S5/S6**：确认只记 backlog，本 change 不碰。

---

## 11. 下一步（本文件确认后）

1. `openspec-new-change` / FF：创建 change，把本文压缩进 `proposal.md` + `design.md` + `tasks.md` + delta specs。  
2. 按 Wave 0→3 实现；每波可合并门禁测试。  
3. `openspec-verify-change` + 手动 MT1–MT4。  
4. 归档 change；用户向 CHANGELOG 一条。  
5. 社区反馈原帖可回复：跨平台逻辑问题；修复点为恢复出口而非 “请重装/清缓存”。

---

## 12. 参考

- 上游设计：`docs/research/mossx-multi-cli-provider-session-foundation-design.md` §14.5  
- 任务清单（历史）：`docs/plans/2026-07-27-multi-cli-provider-session-foundation-task-checklist.md`  
- 手工回归：`docs/reports/multi-cli-session-foundation-a-d-impact-and-manual-test-plan-2026-07-28.md`  
- 关键实现：  
  - `src-tauri/src/shared_session_v2.rs`（`rebuild_binding` / `recover_attempt` / `interrupt_turn`）  
  - `src/features/shared-session/components/SharedSendStatusBar.tsx`  
  - `src/features/shared-session/runtime/sendSharedSessionTurnV2.ts`  
  - `src/features/shared-session/target/sendStateMachine.ts`  
  - `src/i18n/locales/zh/sharedSend.ts`

---

## 13. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-04 | 初稿：社区反馈 + 源码核对；跨平台；P0=恢复出口闭环 |
| 2026-08-04 | **校准 review**：术语表、状态边（禁直跳 idle）、attempt/binding owner、disposition→按钮、迟到证据、interrupt 无能、九态不扩展、Wave2/MT 补测；与基石 §14.5.7 二次补齐对齐 |
