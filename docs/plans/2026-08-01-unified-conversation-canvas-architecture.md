# 统一对话幕布架构改善任务

> **日期**：2026-08-01
> **状态**：PLAN 正文保留 · **关键实现已入库** `bf3b35bd6`（轻量墙下线 + Grok/Kimi/OpenCode 过程投影 + 藏 bash）；OpenSpec change `unify-conversation-canvas`
> **后验**：`docs/analysis/unify-conversation-canvas-review-2026-08-01.md` · 矩阵 `docs/analysis/canvas-live-tool-projection-matrix-2026-08-01.md`
> **依据 / 现网结构**：`docs/analysis/conversation-canvas-structure-2026-07-31.md`
> **滚动另轨**：`2026-08-01-conversation-canvas-scroll-ownership-architecture.md`（`b34fdaead`）
> **目标（原文）**：多 CLI + Shared 共用同一套可预期的幕布体验；砍掉「详情已延迟 / 渲染详情」轻量极简化；修好回合结束锚点。

---

## 0. 一句话目标

**一核呈现、水管补齐、锚点可信、默认可读** —— 不在引擎间「像不像」上各自长一套 UI；用户不应再为「内容去哪了」点「渲染详情」。

---

## 1. 产品决策（已拍板 / 本任务默认）

| # | 决策 | 说明 |
|---|------|------|
| D1 | **砍掉对话级轻量极简化** | 删除/永久关闭：`ConversationLightweightPrompt`、自动 oversized 轻量、行级「详情已延迟」摘要条、「渲染详情」主路径 |
| D2 | **块级「显示详情」保留** | Markdown 重型岛 / 工具重型 output 的「显示详情」**保留**（用户确认）；仅砍对话级+行级摘要墙 |
| D3 | **性能不走「摘要墙」** | 成本用 **流式尾窗 + 闲时虚拟化 +（可选）屏外占位高度** 解决，不用「假摘要冒充内容」 |
| D4 | **一核 + L1 补水管** | 继续 `Messages → Core → Timeline → Row`；差异收敛在 loader/realtime/策略表，不拆多套 Messages |
| D5 | **信息架构不变** | 幕布=叙事；Status Panel=操作痕迹；Diff=工作区；不把 Status 硬塞回幕布「为对称」 |

---

## 2. 问题清单 → 任务映射

| 用户痛点 | 文档锚点 | 根因分层 | 本任务包 |
|----------|----------|----------|----------|
| 多 CLI 幕布不统一 | §1 L1/L2/L3、§5、§5.1 | L1 水管（Grok live 无 tool）+ L2 硬分支 + L3 profile 休眠 | **P0-A / P1-B** |
| 对话结束锚点不准 | §7 settle-repin、§7.1/§7.2 高度阶跃 | 尾窗回全量、remeasure、autoScroll 竞态 | **P0-C**（架构级见 [Scroll Ownership DESIGN](2026-08-01-conversation-canvas-scroll-ownership-architecture.md)） |
| 发送飞顶 / 跟丢最新（A 类） | 滚动多层抢权 + 几何塌缩 | Owner 碎片、echo 启发式、尾窗 shrink | **Scroll Ownership 重构**（不再路径止血） |
| 莫名其妙极简化、要点渲染详情 | §7.2 | lightweight + hydration `summary` + 块级延迟 | **P0-D（砍）** |
| 工具「有时有、有时无」 | §5 藏 bash、§5.1 Grok | 产品藏卡 vs 无事件两套逻辑混谈 | **P0-A 矩阵 + 文案** |
| 长历史滚动卡 | §7 | 误用 summary 顶性能 | **P1-E 保留尾窗/虚拟化** |

---

## 3. 架构原则（统一幕布）

```text
                    ┌─────────────────────────────────────┐
                    │  Presentation Core（一套，禁止分叉）   │
                    │  Messages → Timeline → RowRenderer   │
                    │  默认：正文/工具可读；fileEdit 可折叠  │
                    └──────────────▲──────────────────────┘
                                   │ ConversationItem[]
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
   L1 History Loader         L1 Realtime Adapter      L1 Shared Projection
   (按 thread 前缀)           (按 engine)               (shared: 合并)
          │                        │                        │
   Claude/Codex/Grok…        各 CLI 事件→统一 item     目标引擎 adapter
```

| 层 | 统一什么 | 允许差异 |
|----|----------|----------|
| **呈现核** | kind→组件、fileEdit 场景、footer、滚动/锚点 API | 无第二套 Messages 树 |
| **L1 水管** | 输出统一 `ConversationItem` kinds | 协议能力不同（Grok live 无 tool 须显式 matrix） |
| **L2 策略** | 可见性/ staged MD 等进**可测策略表** | 表项可 per-engine，禁止散落 if 无文档 |
| **L3 profile** | go/no-go：默认开并测，或删冗余 | 禁止「代码在、默认关、当现网」 |

---

## 4. 工作包拆解

### P0-D — 砍掉轻量极简化（「渲染详情」）⭐ 用户点名

**目标**：用户永远不需要为「看正文/工具卡」点「渲染详情 / 显示详情 / 启用轻量模式」。

| 步骤 | 内容 | 验收 |
|------|------|------|
| D.1 | **关闭对话级 lightweight**：`resolveConversationLightweightModeState` 恒 inactive；移除/隐藏 `ConversationLightweightPrompt` UI | 任意长对话无「检测到重型对话」「轻量模式已开启」 |
| D.2 | **关闭行级 summary 呈现**：hydration 不再以 `mode=summary` 渲染摘要条；或 virtualize 时屏外用**等高占位**而非「详情已延迟」文案 | 无灰条 `详情已延迟 · … · 渲染权重` |
| D.3 | **块级延迟保留**：`markdownHeavyBlockDeferred` / `toolHeavyDetailDeferred` +「显示详情」**不删**（用户确认） | 块级仍可按体积延迟；交互文案与行级摘要墙区分 |
| D.4 | **清理行级/对话级 i18n / 测试 / flag** 死路径；perf 回归 | 无行级「要点渲染详情才有内容」 |
| D.5 | **性能替代方案（必做配套）** | 保留：`STREAMING_VISIBLE_WINDOW` 尾窗、闲时虚拟化、`liveTextExternalization`、staged MD、**块级显示详情**；**禁止**行级 summary 墙顶替 |

**边界**

- ✅ 可保留 fileEdit **场景折叠**（产品意图清晰，标题仍说明「文件修改 N 个」）
- ✅ 可保留用户主动折叠的代码块/注解
- ✅ **保留**块级「重型 Markdown / 工具详情已延迟 + 显示详情」
- ❌ 不保留对话级/行级「自动摘要冒充未加载」
- ❌ 不因砍轻量而默认打开 streaming 虚拟化（仍 false，防 attach 飞顶）

**主文件**

- `messagesConversationLightweightMode.ts`
- `messagesTimelineHydration.ts` / `useMessagesTimelineHydration.ts`
- `TimelineRowRenderer` lightweight 摘要条
- `ConversationLightweightPrompt.tsx`
- `messageMarkdownHeavyIslands` / `GenericToolBlock` 重型延迟
- 相关 i18n + Vitest

---

### P0-C — 对话结束锚点不准

**目标**：回合结束 / settle / 尾窗回全量后，视口稳定在**最新内容**（贴底）或**用户已锁定的阅读位置**（不抢夺）。

| 步骤 | 内容 | 验收 |
|------|------|------|
| C.1 | 梳理 settle-repin 与 `stickToBottomDeadline` / `autoScroll` / scroll-echo 竞态 | 时序图或注释契约进 analysis |
| C.2 | **turn-settle 单一 ownership**：仅 turn boundary intent 可在预算窗内 re-arm 贴底；用户上滚后不抢 | 手测：上滚读历史 → 结束回合不拽回底；贴底读 → 结束仍贴最新 |
| C.3 | 尾窗→全量 `scrollHeight` 阶跃：用 bottom-distance 补偿而非裸 `scrollTop` | 结束瞬间无「跳半屏 / 空白」 |
| C.4 | 虚拟化 remeasure 与 settle 同预算协调；超预算可观测 | 诊断可看到 repin/remeasure 计数 |
| C.5 | 砍轻量后回归：无 hydrate 阶跃，但 settle 仍必须过 | 与 P0-D 联测 |

**主文件**

- `useMessagesScrollController.ts`
- `messagesScrollEcho.ts`
- `messagesConstants.ts`（`SETTLE_REPIN_WINDOW_MS` 等）
- `useMessagesTimelineVirtualizer` / hydration remeasure（若仍保留占位）

**回归用例**

- 流式结束贴底
- 流式中用户上滚，结束后保持阅读位
- Shared 目标=Grok/Claude 各一轮
- 长历史 idle 虚拟化开着时 settle

---

### P0-A — 多 CLI 幕布「统一契约」矩阵 + 缺口登记

**目标**：任何引擎在幕布上「该有什么 / 没有什么」可查、可测，禁止再口头混「藏了」和「没事件」。

| 步骤 | 内容 | 验收 |
|------|------|------|
| A.1 | 落地 **Canvas Capability Matrix**（代码或 generated 表） | 至少列：`liveToolProjection` / `historyToolProjection` / `bashCanvasVisible` / `fileEditScene` / `stagedMarkdown` / `liveText` |
| A.2 | **Grok**：`liveToolProjection=unsupported`（协议无 tool 流）；`historyToolProjection=supported` | 与 §5.1 一致；UI 可轻提示「工具轨迹见 Diff / 回合后历史」可选 |
| A.3 | Claude/Codex：`bashCanvasVisible=false` 保持产品定义；fileEdit 场景全引擎一致 | 矩阵 + 症状表同步 |
| A.4 | Shared：呈现 = **目标引擎** 能力；文档写清 | Shared×Grok live 无 tool 卡 = 预期 |
| A.5 | 引擎硬分支审计：`scan-engine-name-branches` 或清单，把「藏/示」迁入策略表 | 新增引擎只加表行 |

**不在 P0-A 做满**：Grok live tool 协议补齐（见 P1-B）。

---

### P1-B — 多 CLI 工具轨迹对齐（水管补齐）

**目标**：在协议允许范围内，缩小「Claude 有卡、Grok 只有 Diff」的体验差。

| 选项 | 内容 | 取舍 |
|------|------|------|
| B1 协议增强 | 若 Grok CLI 未来暴露 tool 流 → map 到统一 tool item | 依赖上游 |
| B2 回合末 history tail | turn complete 后增量拉 jsonl tool 行 merge 进 live items | 有延迟但可「补上」 |
| B3 产品诚实 | live 不承诺 tool 卡；Diff+Status 为操作真相 | 最低成本 |

**建议**：P0 先做 A.2 + B3 文案；P1 评估 B2 是否值得（与 Shared 目标=Grok 一并）。

---

### P1-E — 性能底盘（砍轻量后的护栏）

| 项 | 说明 |
|----|------|
| 流式尾窗 | 保持 `STREAMING_VISIBLE_WINDOW=60`，禁止 streaming 虚拟化默认开 |
| 闲时虚拟化 | 保持 idle 门槛；屏外行可用**空白/等高占位**，禁止「详情已延迟」文案占位 |
| live-text / staged MD | 保留；perf 回归必跑 |
| 长历史打开 | oversized 不再自动轻量；用虚拟化 + 测量预算 |

---

### P1-F — 呈现策略表 / profile go-no-go

| 项 | 说明 |
|----|------|
| 收敛 `if (engine===…)` 散落 | bash 可见、staged MD、activity 摘要 → 策略表 |
| presentationProfile | 默认开并测 **或** 删死字段，禁止第三套休眠真相 |
| dock reasoning 死路径 | 删或 debug-only |

---

### P2 — 体验与文档

| 项 | 说明 |
|----|------|
| 幕布 / Status / Diff 一页用户说明 | 「命令在哪」「文件改动在哪」 |
| 更新 analysis §7.2 状态为 **Removed** | 与实现同步 |
| OpenSpec change | `unify-conversation-canvas`（或拆多个 change） |

---

## 5. 建议实施顺序（里程碑）

```text
M0  契约冻结
    - 确认 D1–D5（尤其砍轻量）
    - OpenSpec change + 能力矩阵草稿
    - 手测基线录像：Grok 写文件 / 回合结束锚点 / 详情延迟

M1  P0-D 砍轻量 + P0-C 锚点（可并行，联测收口）
    - 默认幕布始终可读
    - settle 贴底/不抢读 通过

M2  P0-A 矩阵 + 症状/文案 + Shared 说明
    - 多 CLI「为何看不见 tool」可解释

M3  P1-E 性能回归 + P1-F 策略表
    - 长历史不卡、无 summary 墙回潮

M4  P1-B（可选）Grok/Kimi live 工具补齐评估
```

---

## 6. 验收标准（总）

### 必须（P0）

1. **无**「详情已延迟 / 渲染详情 / 启用轻量模式 / 重型 Markdown 详情已延迟」主路径 UI。
2. 首屏助手正文、工具卡（**有 L1 数据时**）默认可读。
3. 回合结束：贴底阅读不丢最新；上滚阅读不被拽回。
4. 能力矩阵可查：Claude/Codex/Grok/Kimi/OpenCode/Shared 的 live/history tool 行为。
5. 回归：流式贴底、上滚不抢、fileEdit 折叠、Shared 切换目标引擎。

### 应该（P1）

6. 硬分支减少、策略表可单测。
7. Grok live 工具缺口有产品说明或 tail 回补方案。
8. 长历史（200+ 行）滚动可接受（虚拟化，无摘要墙）。

### 不做

- 不为每个 CLI 拆 Messages 树
- 不把 Diff/Status 逻辑搬进幕布当 tool 假投影（无真实 tool item 时）
- 不恢复 streaming 默认虚拟化
- 不批量清理无关 orphan session

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 砍轻量后超长对话卡顿 | M1 必须带 P1-E 基线；虚拟化 + 尾窗；可 feature flag 一周回滚 lightweight **仅应急** |
| settle 改坏上滚阅读 | C.2 显式 user-scroll ownership 测试 |
| Grok 用户仍觉得「没干活」 | A.2/B3 文案 + Diff 入口；勿伪造 tool 卡 |
| 双 PR 改同一 Timeline 文件 | 语义合并，禁止整文件 ours/theirs（AGENTS merge guardrails） |

**回滚**：lightweight 删除用单一 commit/flag；锚点与砍轻量分 commit，便于 `git revert`。

---

## 8. 任务拆分建议（执行单元）

| ID | 标题 | 优先级 | 依赖 |
|----|------|--------|------|
| UC-01 | OpenSpec：`unify-conversation-canvas` proposal/design/tasks | P0 | — |
| UC-02 | 砍对话级 lightweight + 摘要条 UI | P0 | UC-01 |
| UC-03 | 砍/收敛块级 Markdown·工具「显示详情」 | P0 | UC-02 |
| UC-04 | 性能护栏：尾窗+虚拟化回归套件 | P0 | UC-02 |
| UC-05 | settle-repin / 回合结束锚点 ownership | P0 | UC-01（可与 UC-02 并行） |
| UC-06 | Canvas capability matrix + Grok live tool 文档化 | P0 | UC-01 |
| UC-07 | 引擎策略表收敛（bash/staged MD） | P1 | UC-06 |
| UC-08 | Grok/Kimi live tool 补齐评估（B2/B1） | P1 | UC-06 |
| UC-09 | presentationProfile go/no-go + dock 死路径 | P1 | UC-07 |
| UC-10 | analysis 文档归档：§7.2 → Removed；矩阵同步 | P0 | UC-02 完成时 |

---

## 9. 手测清单（最小）

| # | 场景 | 期望 |
|---|------|------|
| 1 | Claude 长对话闲时滚动 | 无摘要条；可读；可虚拟化 |
| 2 | Claude/Codex 跑 bash | 幕布可无 command 卡；Status 有痕迹（产品） |
| 3 | Grok 实时写 md | 幕布可无 Read/Edit 卡；Diff 有变更；**无**「详情已延迟」 |
| 4 | 任意引擎回合结束贴底 | 最新助手可见 |
| 5 | 流式中上滚再结束 | 不强制拽回底 |
| 6 | Shared 目标切换 Grok/Claude | 呈现跟目标；无轻量墙 |
| 7 | fileEdit 多文件 | 默认折叠场景，点开见 diff |

---

## 10. 关联文档

| 文档 | 用途 |
|------|------|
| `docs/analysis/conversation-canvas-structure-2026-07-31.md` | 现状事实源（§5.1 / §7.1 / §7.2） |
| `docs/perf/render-jank-knife-experiments-2026-07-08.md` | 渲染 jank 红线 |
| `docs/perf/streaming-render-stall-design-2026-07-30.md` | 流式卡顿 |
| `docs/chat-canvas-conversation-curtain-contracts.md` | 契约旁路（以源码为准） |

---

## 11. 建议 OpenSpec change-id

```text
unify-conversation-canvas
```

可拆 delta（若体量过大）：

- `remove-conversation-lightweight-summary`（P0-D）
- `fix-turn-settle-scroll-anchor`（P0-C）
- `canvas-engine-capability-matrix`（P0-A）

---

## 实现状态快照（2026-08-01，已入库）

> **内容类型**：Plan + implementation handoff
> **生命周期**：implemented；OpenSpec change `unify-conversation-canvas` 为 `23/23`，仍 active，待 verify / sync / archive
> **最后校准**：mossx `0.7.14`，HEAD `26f8065a0c`；核心实现 commit `bf3b35bd6`
> **事实源**：当前源码、`openspec/changes/unify-conversation-canvas/`、后验 review 与 capability matrix

| 包 | 状态 |
|----|------|
| 砍对话/行级轻量 | ✅ |
| 块级显示详情 | ✅ 保留 |
| Grok jsonl tool 桥 + resume baseline + 增量 tail | ✅ |
| 五引擎藏 bash（对齐 Claude） | ✅ |
| settle 行为改造 | ⏸ 维持 re-pin 契约 |
| Review | `docs/analysis/unify-conversation-canvas-review-2026-08-01.md` |

*本文件保留实施前 PLAN 与决策过程；当前实现以 `bf3b35bd6` 后的源码 + OpenSpec change 为准。*
