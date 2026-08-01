# unify-conversation-canvas 多角度 Review（2026-08-01）

> **文档性质**：**过程后验**（改前判断 + 实施完成度 + 入库后校准）。**不删除**实施期结论，只追加「当时→现在」。
> **范围（当时）**：轻量墙下线 + Grok/Kimi/OpenCode live tool 水管 + Claude 对齐藏 bash
> **实现 commit**：`bf3b35bd6`（feat(messages): 统一幕布轻量下线并接齐 Grok/Kimi/OpenCode 过程投影）
> **OpenSpec 状态**：`23/23`；change 仍 active，待 verify / sync / archive
> **关联**：[`conversation-canvas-structure-2026-07-31.md`](./conversation-canvas-structure-2026-07-31.md) · [`canvas-live-tool-projection-matrix-2026-08-01.md`](./canvas-live-tool-projection-matrix-2026-08-01.md) · OpenSpec `unify-conversation-canvas`
> **索引**：[`README.md`](./README.md)

---

## 0. 30 秒结论

| 问题 | 实施期答案（2026-08-01） | **入库后（校准）** |
|------|--------------------------|-------------------|
| 这批改完「像 Claude 了吗」？ | 信息架构更像；保真度仍不如原生协议 | **不变**：策略对齐，Grok 仍是桥 |
| 水管接好了吗？ | Grok=jsonl 桥已硬化；Kimi/OpenCode 映射补强 | **是**，在 `bf3b35bd6` |
| 能不能上主线？ | 需手测；代码层 P0/P1 已修；**当时未 commit** | **已 commit**；手测清单仍在 matrix |

---

## 1. 换角度看：产品 / 架构 / 时序 / 可靠性 / 测试

### 1.1 产品视角（用户体感）

| 用户故事 | 改前 | 改后预期 | 入库后 |
|----------|------|----------|--------|
| 长对话正文被「详情已延迟」挡住 | 常有 | **不应再有**行级/对话级摘要墙 | 代码恒 inactive；旧包除外 |
| Grok 改文件只有 Diff 在动 | 幕布几乎无过程 | 幕布应出现 **读/写类** tool 卡（可滞后 ~200ms） | 桥已合入；手测仍建议 |
| Grok/Kimi bash 刷屏 | 可能很吵 | **与 Claude 一样藏 command/bashGroup** | 五引擎 hide |
| 续聊第二轮闪旧 tool | 旧实现会 | **resume baseline=EOF** | 已在 grok_history |
| 新会话第一批 tool 被吃掉 | 旧 baseline 竞态会 | **new session / saw_missing → 从 0 读** | 已修 |

**仍不像 Claude 的地方**（保留，非回归）

- Grok 工具时序跟 **磁盘写 jsonl**
- fileChange **结构化 diff** 常弱于 Codex
- Status Panel 与幕布分工需用户心智（bash 去 Status）

### 1.2 架构视角

```text
理想统一（目标）
  L1 各 CLI  → 统一 Tool* / Message* → 同一 Messages 核 → Claude 级策略（藏 bash）

当前实际（入库后）
  Claude/Codex  ──原生协议──► Tool*
  Kimi/OpenCode ──原生 stream──► Tool*
  Grok          ──jsonl poll──► Tool*（旁路 · 已硬化）
                    │
                    ▼
              同一 engine_event_to_app_server + FE adapter + Timeline
                    │
                    ▼
              shouldHideCodexCanvasCommandCard（五引擎藏 bash）
```

- **呈现核统一** ✅
- **信号源不统一** ⚠️（Grok 旁路是正确取舍）
- **策略层向 Claude 收敛** ✅

### 1.3 时序 / 竞态视角

| 场景 | 机制 | 状态 |
|------|------|------|
| Resume 续聊 | `for_turn(true)` → baseline=EOF | ✅ |
| 全新会话 | `for_turn(false)` 或 `saw_missing` → offset=0 | ✅ |
| 半行 JSON | carry 缓冲 | ✅ |
| 文件截断 | offset 回 0 | ✅ |
| 首轮 path 未创建 | 等 exists 再 poll | ✅ |
| 误传 resume=true 于新会话 | 会跳过首批 | 依赖 `resume_session` 正确 |
| poll 与 TurnCompleted | stop 后 final poll | ✅ 设计有 |
| broadcast lag | `let _ = send` 可能丢 | ⚠️ 原有问题 |

### 1.4 可靠性 / 性能

| 点 | 评价 |
|----|------|
| 增量 tail | 好 |
| 200ms 轮询 | 可接受 |
| path cache | 有 |
| lightweight 死代码 | Prompt 短路；i18n/hooks 可残留（P2） |

### 1.5 测试视角

| 有 | 缺 / 持续 |
|----|-----------|
| drain 幂等、baseline + incremental 文件测 | 端到端「幕布出现 read 卡」 |
| lightweight 单元（恒 inactive） | 手测三引擎矩阵清单 |
| | bash 隐藏对 grok 的 focused Vitest（可选） |

---

## 2. 目标完成度

| 项 | 实施期 | **入库后** |
|----|--------|------------|
| 砍对话/行级轻量墙 | 高 | **已 commit** |
| 块级显示详情保留 | 高 | **已 commit** |
| P0 resume 不重放 | 高 | **已 commit** |
| P1 增量 tail | 高 | **已 commit** |
| P1 新会话不吞首批 | 高 | **已 commit** |
| 对齐 Claude 藏 bash | 高 | **已 commit** |
| 过程展示 ≈ Claude | 中 | 中（预期） |
| settle 锚点改造 | 低（仅注释契约） | 滚动**另轨** `b34fdaead`（§7.3 structure） |
| commit | **无（当时）** | **`bf3b35bd6`** |

OpenSpec `tasks.md`：Phase A–E 共 `23/23` 勾选完成；change 仍 active，待 verify / sync / archive（本文不替代流程收口）。

---

## 3. 与 Claude 幕布「像不像」

**像（产品策略）**

1. 同一套 Messages / Timeline / fileEdit 折叠
2. bash/command **不污染幕布**
3. 读/写类工具**意图上可见**

**不像（保真度）**

1. Claude 协议即时；Grok 文件 poll
2. payload 结构化程度
3. Status 分工打磨年限

**产品一句话**
> 目标不是像素级复刻 Claude，而是：**多 CLI 共用同一套「干净幕布」规则**——过程可读、shell 不吵、不造假。

---

## 4. 已知残留 / 后续

| 优先级 | 项 | 校准 |
|--------|-----|------|
| 手测 | 矩阵读+写+搜+删 | 仍建议 |
| 已补 | 特殊工具名表 / completed path 回填 / fileChange 块路由 | 在 commit 内 |
| P2 | 删 lightweight 死状态 / i18n 残留 | 可选清理 |
| P2 | capability matrix codegen | 未做 |
| 并行轨 | 滚动 A/F 实机验收 | `b34fdaead` + scroll change |
| 观察 | Shared 目标=Grok；Task 长跑专用卡 | 产品观察 |

---

## 5. 怎么读本 Review（过程保留）

1. §0–§3：产品/架构判断（实施期写成，**结论大多仍成立**）
2. matrix 手测表：验收清单
3. structure §5.1 / §7.2 / §7.3：现网结构真相
4. 需要追溯「为何砍轻量墙」：保留本文件，不要只看 matrix

---

## 6. 演进记录

| 日期 | 说明 |
|------|------|
| 2026-08-01 | 初版 Review：工作树未 commit 的实施通读 |
| 2026-08-01 | **后验校准**：对照 `bf3b35bd6`；§0/§2 增加「入库后」列；去掉「禁止上主线因未 commit」；settle 指向 scroll 独立轨 |
