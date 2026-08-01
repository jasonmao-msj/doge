# 多 CLI × 多 Provider 会话基石 A–D：代码梳理、客户端影响与人工测试计划

> **2026-08-01 生命周期校准**：A–D canonical changes 已归档；本文作为影响与 release smoke 证据保留。后续 Native/Shared repair changes 不回填为 A–D 未完成项。
> - 初始分析日期：2026-07-28
> - 最近校准：2026-07-29
> - 分析窗口：2026-07-27～2026-07-29
> - 基线分支：`feature/v-0710`
> - 文档性质：代码与 OpenSpec 现状审计、A–D 实际影响、人工验收计划、D 后路线图
> - 上游设计：[`mossx-multi-cli-provider-session-foundation-design.md`](../research/mossx-multi-cli-provider-session-foundation-design.md)
> - 总任务清单：[`2026-07-27-multi-cli-provider-session-foundation-task-checklist.md`](../plans/2026-07-27-multi-cli-provider-session-foundation-task-checklist.md)
> - Change D：[`add-native-provider-continuation`](../../openspec/changes/archive/2026-07-28-add-native-provider-continuation/)
> - Shared history recovery 校准：[`fix-shared-canonical-history-recovery`](../../openspec/changes/fix-shared-canonical-history-recovery/)

## 0. 怎么读这篇文档

这篇文档同时服务产品判断、开发核对和人工测试，所以保留了一些代码里的 English identifier。你不需要先理解这些词，再去看结论。

如果只关心客户端会发生什么变化，按这个顺序看：

1. 先看第 1 章，了解 A–D 合起来解决什么问题
2. 再看第 4、5 章，了解界面和实际使用体验
3. 要亲自测试时看第 6、7、8 章
4. 要判断下一步做什么，看第 9、10、11 章

### 0.1 常见术语的大白话解释

| 专业词 | 大白话解释 |
| --- | --- |
| CLI | Claude Code、Codex、Kimi 这类在命令行运行的 AI 工具 |
| Provider | 给 CLI 提供模型和 API 的服务商配置，例如 Official、OpenRouter 或某个自定义服务商 |
| Shared Session | mossx 管理的“共享会话”。界面只显示一条会话，内部可以轮流使用多个 CLI 和 Provider |
| Native Session | 某个 CLI 自己创建和维护的“原生会话”，历史文件也归这个 CLI 管 |
| Execution Target | “这一轮具体交给谁执行”的完整选择，包含 CLI、Provider、Model 和 Reasoning |
| Binding | mossx 为某个执行目标保存的固定连接，可以理解为“这条共享会话在这个 Provider 里对应哪个隐藏原生会话” |
| Canonical Fact | 统一格式的会话事实流水账。无论底层是哪家 CLI，最终都按同一种格式记录 |
| Projection | 把底层事实流水账整理成聊天界面能显示的数据 |
| Context Package | 切换 Provider 时，mossx 打包给新目标的历史上下文 |
| Materialization | 在创建新会话前，把来源历史冻结成一份不可变材料。以后重试继续用这份材料，不重新读取可能已经变化的源文件 |
| ACK | 目标 CLI 明确确认“我已经收到” |
| Cursor | 同步进度，表示历史已经处理到哪里 |
| Two-phase cursor | 两段同步进度：先记“目标已经收到”，再记“这一轮已经完成” |
| Artifact | 不适合直接塞进上下文的大内容，例如超长 Tool Output。系统把它单独保存，需要时再读取 |
| Fidelity | 历史还原完整度。`strong` 表示高完整度，`degraded` 表示存在转换或省略 |
| Omission | 为适配目标能力或上下文长度而省略的内容 |
| Fail closed | 看不准就停止，不猜、不冒险继续 |
| Provenance | 这条消息实际由哪个 CLI、Provider、Model 生成 |
| Lineage | 会话之间的来源关系，例如新续接会话是从哪条旧会话来的 |
| Runtime | 真正运行中的 CLI 进程 |
| Logical settlement | Agent 业务回合已经有最终结果，Shared Composer 可以结束本轮 |
| Runtime cleanup | logical settlement 之后的进程回收、stdio drain、hook/MCP child 退出与补充 usage |
| Canonical envelope | Canonical Fact 在 SQLite row 与 tagged JSON payload 中使用的统一封装 |
| Side effect | 已经在外部产生的真实变化，例如创建了一个 Codex thread |
| Recovery | App 崩溃或网络中断后，从已保存进度继续，不重复创建或重复发送 |
| Recovery owner | 负责解释和修复某类故障的状态机；Shared Attempt/Binding 与 Native runtime 各自独立 |
| Owner routing | 把停止、审批、重试等操作发给真正执行当前任务的 CLI 和 Provider |
| Dark launch | 新链路在后台运行和对比，但默认不接管用户真实操作 |

## 1. 结论先行

这两天做的不是多加一个“CLI 选择框”，而是在替换会话系统的底层骨架：

```text
Change A：先把每轮对话记准，而且历史坏了还能重建
        ↓
Change B：明确这一轮到底交给哪个 CLI、Provider 和 Model
        ↓
Change C：换 Provider 时安全搬运上下文，失败后还能接着恢复
        ↓
Change D：从旧的原生会话创建一条跨 Provider 的新续接会话
```

四个 Change 完成后，客户端的核心变化是：

> 用户可以在一条共享会话里，每一轮选择不同的 CLI、Provider、Model 和 Reasoning。用户也可以从已有原生会话创建一条独立的跨 Provider 续接会话。系统会准确记录每轮是谁执行、搬了哪些历史、删减了什么、失败后该从哪里恢复，不再复制 CLI 自己的历史文件，也不会失败后偷偷换到别的 Provider。

用户最容易感知的变化有五项：

1. 输入框里的选择不再只是“选模型”，而是在决定下一轮由谁执行
2. 每轮历史都会保留当时使用的 CLI、Provider 和 Model，不会因为你后来改了选择而变化
3. 切换 Provider 时，mossx 会补齐对方缺少的历史；如果需要压缩或省略，必须先告诉你
4. 右键原生会话，可以选择“使用其他 Provider 继续”，系统会新建一条独立会话
5. 新会话显示“供应商续接”，可以跳回来源，但不会被错误显示成“子代理”

变化强度判断：

| 维度 | 变化等级 | 判断 |
| --- | --- | --- |
| UI 外观 | 中 | 主要新增“本轮由谁执行”的标签、发送状态、历史删减确认、续接菜单、续接标签与来源导航 |
| 交互模型 | 大 | 从“一条会话固定使用一个执行环境”，升级为“共享会话每轮可以换目标，原生会话可以派生新续接会话” |
| 会话可靠性 | 很大 | 系统会统一记账，固定保存每个目标的连接，分两步记录同步进度，并在创建目标前冻结来源历史 |
| 历史兼容 | 中到大 | 老共享会话继续可读；新历史可以重建；原生历史仍由原 CLI 管理 |
| 日常学习成本 | 中 | 用户需要理解三个动作：共享会话换目标、原生会话新建续接、确认有损上下文 |

## 2. 当前到底做到了哪一步

这一章把“已经验证完成”“代码正在写”和“未来预测”分开。避免看到界面代码后，就误以为整条功能已经可以发布。

### 2.1 规划与验收进度

| Change | 范围 | 状态 | 当前证据 |
| --- | --- | --- | --- |
| Change A（A1/A2/A3） | 保存统一会话事实、从事实重建聊天历史、兼容老数据 | **完成** | 56/56，三道验收门槛已通过 |
| Change B | 选择本轮执行目标、真实发送、保存目标连接、把操作发给正确执行者 | **完成** | 40/40，第四道验收门槛已通过并归档 |
| Change C | 打包和转换上下文、确认目标收到、记录同步进度、保存大内容、压缩长历史 | **完成** | 44/44，第五道验收门槛已通过并归档 |
| Change D | 只读原生历史、冻结来源材料、创建跨 Provider 续接、记录来源关系、显示 Sidebar 入口 | **实现完成，待发布前人工 smoke** | OpenSpec 19/19；Desktop Claude/Codex target、recovery、catalog/UI 与增量验证已完成 |

2026-07-28 生产校准补充：A–D 代码与设计逐项对照后，修复了 7 类会影响发布的
contract 缺口：Context Package identity 冲突、artifact payload 未验真、Windows 原子
发布、Native History private block/Tool pairing、超大 JSONL 阻塞、Codex capability
猜测和 macOS `window.confirm` 失效。修复没有扩大产品范围。

2026-07-28 第二次 UX 反向验收补充：此前“backend contract 已完成”被错误等同为
“用户操作闭环已完成”。截图复验确认了 Provider 模型不可选、Kimi 被静默隐藏、
续接仍依赖系统原生确认、协议 hash 直接进入标题/幕布、来源导航不可达等缺口。
本轮已将它们补成真实 UI：

- Shared 模型菜单按 `CLI → Provider → Model` 展开，并一次性提交完整 Target。
- Claude/Codex Provider 分别加载自己的模型；同名模型不再用于反推 Provider。
- Kimi 作为已知 CLI 显示为 disabled，并明确说明“目标续接尚未验证”。
- 续接使用 mossx 自己的 Dialog；取消前不创建目标，degraded 明细在产品内二次确认。
- `MOSSX_CONTEXT_PACKAGE/ACCEPTED` 只作为 control-plane 证据，不再作为聊天内容展示。
- 新续接会话使用“继续：来源会话”标题；既有消息滚动区顶部显示默认折叠的
  来源 → 目标摘要，展开后可“查看来源”，不改变普通消息排列。
- Claude bootstrap 不再把“模型必须逐字回 marker”误当 transport ACK；首次 CLI
  已完成就收口，异常重试只校验同一个 target，不重复创建。
- Shared send 以当前 Target Store 为准，逐 Turn 冻结真实 CLI/Provider/Model；
  unsupported 历史 Target 明确阻止，不偷偷改发 Claude。

2026-07-29 Shared Session 生产回归校准：真实 Claude Code/Codex CLI 交叉切换继续暴露出
terminal、history projection 与 recovery ownership 三类断裂。本轮没有扩大到普通 Native
Session，而是在 Shared boundary 完成以下收口：

- Shared completion 统一等待 backend exact-Attempt settlement。Provider typed final/result
  立即形成 `run.settled`；process、stdio、hook、MCP child 与 usage cleanup 不再阻塞 Composer。
- accepted start ACK、inline frontend event 与 Engine 名称都不再承担 terminal authority。
  duplicate final、cumulative/full observation 与迟到 cleanup terminal 按 Attempt 幂等吸收。
- delivery fact 统一通过 canonical writer 写入完整 tagged envelope，并与 Binding state
  保持同一 SQLite transaction。
- 旧 type-less object payload 在 Projection decode boundary 使用 row `fact_type` 补齐；
  embedded type conflict 或非 object payload 继续 fail closed，不改写旧 row/checksum。
- Shared projection failure 只在 Legacy snapshot 有实际内容时降级显示。Legacy 为空时保留
  retryable error，不调用 Native resume，不写 Native recovery scope，也不显示 Native recovery card。
- Shared history lookup 固定使用 `shared:<UUID>`。首条消息推导标题或后续改名只更新
  presentation metadata，不改变 Projection checkpoint、cache 或 recovery identity。

本轮增量证据：

- 产品 owner 已验证 Shared Claude CLI 与 Codex CLI 交叉切换、切回与正常结束。
- Frontend focused tests：26/26 通过。
- Rust focused tests：`shared_projection` 20/20、`shared_context` 3/3、
  `shared_session_v2` 14/14 通过。
- `npm run typecheck`、scoped ESLint、`npm run check:runtime-contracts`、`cargo check`、
  changed-file `rustfmt --check` 与当前 OpenSpec strict validation 通过。
- 该证据只覆盖 Shared Session，不替代 Change D 的 Native Provider Continuation Desktop smoke。

### 2.2 Change D 的真实进度

大白话：D 的代码与自动化闭环已经完成。发布前还要用真实 Claude/Codex Provider
走一遍，确认 vendor 版本和真实账号环境没有偏差。

已完成：

- Claude、Codex、Kimi 原生历史 Reader、稳定边界、来源指纹与 typed error
- 原生历史 Context Package、typed Artifact、SQLite immutable materialization
- Desktop Codex structured inject；Claude 以 completed bootstrap + durable history evidence
  收口，exact echo 仅保留为兼容恢复证据
- 同 operation recovery、artifact integrity、canonical target identity、catalog retry
- Provider Binding、Origin / Family、顶层“供应商续接”标签与来源导航
- Claude/Codex 双向 Provider Picker、重复点击保护
- 展示 mode、token estimate、omission 的 degraded confirmation
- 清退 Codex vendor rollout copy 与 `native-provider-rebind`
- Change D 定向 Rust、Vitest、typecheck、runtime-contract checks

本轮校准自动化证据：

- Rust：Native History/Continuation 31 条、Shared Context unit 8 条、A–D 相关 integration 19 条通过。
- Frontend：Sidebar continuation + Shared Session 16 个 test files、136 条通过。
- `npm run typecheck`、scoped ESLint、`npm run check:runtime-contracts`、changed-file
  `rustfmt --check`、Markdown table/link check、当前 calibration OpenSpec strict validation 通过。

第二次 UX 校准增量证据：

- Frontend：26 个相关 test files，256 tests 通过、2 skipped（包含 i18n）。
- Rust：Shared V2/Context/Projection 27 tests、Native History/Continuation 13 tests，
  共 40 tests 通过。
- `npm run typecheck`、scoped ESLint（0 error / 0 warning）、
  `npm run check:runtime-contracts`、`npm run check:model-provider-catalog`、
  Markdown table/link check 与 OpenSpec strict validation 通过。
- `npm run check:large-files` 只报告仓库既有 baseline 超限项；本轮新增文件未触线。

保留为发布前人工 gate：

- Claude Provider A → Codex Provider B → 原 Claude Provider
- 观察历史连续性、degraded confirmation、真实 Provider 命中与 recovery

### 2.3 当前范围上的重要限制

当前边界：

- Claude、Codex、Kimi 可以作为来源，但系统必须能证明读取边界稳定
- Desktop 目标端支持 Claude 与 Codex
- Kimi target 暂无可证明的 acceptance，因此 typed unsupported
- remote daemon 保持同 command/camelCase payload，但在缺少原生历史与 artifact owner 时
  typed unsupported，不静默 fallback

## 3. 两天工作梳理

这一章按 A、B、C、D 解释这两天的工作。每节先说系统做了什么，再说用户能感受到什么。

### 3.1 Change A：先造不可见地基

Change A 被拆为 A1、A2、A3，避免把存储、事实装配和 UI Projection 混成一个不可验证的大 Change。

#### A1：可靠保存每一条会话事实

建立：

- 用 SQLite 保存 Shared V2 数据，并支持后续数据库升级
- 所有事实排队写入，避免并发写入时抢编号
- “写入事实”和“推进编号”在同一个数据库事务里完成，不能只成功一半
- 同一事件重复到达时只记一次，Token 用量也不会重复累加
- 用强制退出和断电模拟证明数据库不会留下半条数据
- 数据损坏后进入只读恢复，不创建空库覆盖旧数据

用户直接感知：几乎没有。

工程价值：后续所有 Shared V2 能力有了可恢复、可审计、可重放的事实地基。

#### A2：把三家 CLI 的结果记成同一种账

建立：

- 统一记录“用户发起、上下文已送达、目标已收到、本轮已完成、Token 用量、控制消息”
- 即使中间 streaming 消息丢失，也以最终结果拼出完整的一轮
- 最终结果只有安全写入数据库后，才算真正完成
- Tool Call 和 Tool Result 必须成对处理，不能只显示一半
- Token 用量支持修订和替换，不把两份累计数据重复相加
- 旧系统的最终结果只读复制到影子流水账，用来对比新旧结果

用户直接感知：默认没有。

工程价值：不再把容易丢失的流式碎片当成最终真相；工具失败、Token 用量和一轮是否结束都有统一判断。

#### A3：把新流水账重新显示成聊天记录

建立：

- 把统一事实转换成现有聊天界面认识的消息格式
- 保存重建进度；缓存删掉后还能按相同顺序重建
- 老共享会话继续使用旧快照读取，缺失的技术事实不伪造
- 同一会话用新旧两套方式计算，再记录差异
- 保证原生会话和共享会话互不污染，聊天界面不闪烁、不重复
- 提供开发开关，让开发者动态验证新投影

用户直接感知：正常情况下应与旧 UI 一致。

工程价值：新内核可以逐步替换旧读取方式，但老会话继续能看；聊天缓存丢失时可以从事实流水账重建。

### 3.2 Change B：执行目标进入真实产品链路

Change B 把 dark launch 变成真实 Send：

- 分开保存“下一轮准备选谁”和“当前这一轮实际由谁执行”
- 一个执行目标包含 CLI、Provider、Model 和 Reasoning
- 从“每个 CLI 一个连接”升级为“每个 CLI + Provider 组合一个连接”
- 同一条共享会话切换 Provider 时，内部复用各自的隐藏原生会话
- 发送、收到确认、本轮结束、停止、审批和恢复都携带完整 Provider 身份
- 创建隐藏会话时保存完整进度；无法确认是否创建成功时进入恢复状态，不再盲目新建
- 界面展示准备、发送、上下文有损、取消和恢复状态

Change B 解决的是：

> “这一轮到底由谁执行，以及失败时该停止、恢复、审批谁。”

### 3.3 Change C：上下文交付从拼文本升级为协议

Change C 建立：

- 带版本、内容清单和校验码的上下文包
- 根据目标真实能力选择五种历史交付方式，而不是按 CLI 名称猜
- 清理或转换目标不支持的 reasoning、Tool、Image 和失败消息
- Codex 使用原生导入；Claude 校验回显；Kimi 无法强确认时明确标记弱确认
- 分别记录“目标已收到”和“本轮已完成”
- App 崩溃后根据待投递记录继续恢复
- 超长内容单独保存，目标需要时再按引用读取
- 历史太长时生成结构化摘要，明确展示省略内容，用户确认后才继续
- 按内容类型稳定压缩，连续切换时只追加新历史，不反复重写旧部分

Change C 解决的是：

> “换 Provider 后带过去什么、丢了什么、目标是否真的收到、重启后从哪里继续。”

### 3.4 Change D：让原生会话也能跨 Provider 续接

Change D 不允许在原 Native Session 内热切 Provider，而是：

```text
来源原生会话（只读，保持不变）
        ↓ 读取到一个稳定边界
冻结一份不可变的来源历史材料
        ↓ 按目标能力转换和压缩
创建目标 Provider 的新原生会话
        ↓
记录“供应商续接”类型和来源关系
        ↓
在 Sidebar 顶层显示新会话
```

它替换了旧 Codex 跨 Provider fork 的错误做法：

- 不复制 vendor rollout。
- 不修改 vendor history。
- 不写 `parentThreadId`。
- 不投影为 Subagent。
- ACK ambiguous 时不盲建。

## 4. A–D 完成后的 UI 变化清单

这一章只回答一个问题：客户端界面具体会多什么、少什么、改变什么。

### 4.1 输入框与发送区

| UI 位置 | 改动前 | 改动后 | 你能感受到什么 |
| --- | --- | --- | --- |
| CLI / Provider / Model / Reasoning 选择 | 多处选择的含义混在一起 | 当前选择明确表示“下一轮准备交给谁” | 改选择不会影响正在运行或已经完成的消息 |
| 发送进行中 | 界面当前选择可能和真实执行者不一致 | 本轮目标被冻结，运行中锁住选择器 | 不会发送到一半突然换 Provider |
| Provider 的 Model 列表 | 可能误用默认 Provider 的 Model | 只显示当前 Provider 真正提供的 Model | 少见“选得到但跑不了”的 Model |
| 历史需要压缩 | 可能静默删减或只给模糊提示 | 显示压缩前后 Token、删了什么，确认后才发送 | 你能判断上下文损失是否可以接受 |
| 创建或投递失败 | 可能只能再点一次 | 明确显示“需要恢复”或“Provider 不可用” | 不会因反复点击创建重复会话 |

### 4.2 聊天内容区

| UI 位置 | 改动前 | 改动后 | 你能感受到什么 |
| --- | --- | --- | --- |
| 每轮由谁回答 | 历史消息的真实 Provider 不够稳定 | 每轮显示当时使用的 CLI、Provider 和 Model 标签 | 可以追溯“这段回答是谁生成的” |
| 切换执行目标 | 可能重建历史或连错隐藏会话 | 聊天区域不重新挂载，旧消息和标签不变 | 切换更平滑，历史不会闪空或变形 |
| Tool 执行 | 可能只显示 Tool Call，没有对应结果 | Tool Call 和 Tool Result 成对保留或成对省略 | 不会把残缺的工具执行误看成成功 |
| 超长上下文 | 按固定字符数截断 | 生成结构化摘要，大内容单独保存 | 长会话换 Provider 后更容易接上前文 |
| 老共享会话 | 依赖旧快照 | 新旧读取方式并存，缺什么就承认缺什么 | 升级后老会话还能正常查看 |

### 4.3 左侧会话栏

| UI 位置 | 改动前 | 改动后 | 你能感受到什么 |
| --- | --- | --- | --- |
| 共享会话 | 内部隐藏连接可能被误显示成新会话 | 始终只显示一个共享会话，内部连接不显示 | 反复切 Provider 也不会把 Sidebar 塞满 |
| 原生会话右键菜单 | 跨 Provider 依赖旧 Fork 做法 | 新增“使用其他 Provider 继续”；Kimi 目标未验证时显示禁用原因 | 可以从已有对话安全换 Provider，也不会把不支持误装成可用 |
| 新续接会话 | 没有独立类型，标题可能直接显示协议 hash | 顶层显示“续接”和“继续：来源会话”可读标题 | 能和普通会话、Fork、Subagent 区分 |
| 来源导航 | 没有可靠来源关系 | 新会话在既有消息滚动区顶部显示默认折叠的来源 → 目标摘要，展开后有“查看来源”按钮 | 可以回到最初那条对话核对原文，不打破消息布局 |
| 续接协议消息 | package/checksum、bootstrap reasoning/回复可能直接进入聊天幕布 | 隐藏从 protocol user entry 到下一条真实 user message 的完整 control exchange | 用户只看正常对话；普通提到 MOSSX 的文本仍保留 |
| 同一会话家族 | 只有零散关系 | 保存家族编号、根会话和直接来源 | 为以后按家族折叠或分组打底 |

注意：A–D 第一阶段不做 Conversation Family 折叠或树形分组。Continuation 仍是顶层 Row。

### 4.4 设置与问题诊断

开发者可以利用这些能力排查问题：

- 动态切换新的共享会话读取方式
- 通过功能开关启用或回退 Shared V2 发送
- 查看新旧历史差异、恢复状态、省略内容和大文件校验失败

当前仍不足：

- 没有面向普通用户的 Continuation operation history / recovery center。
- 没有完整 Event Log Inspector。
- typed continuation error 仍可能被压成通用 runtime notice。

## 5. 实际使用体验变化清单

这一章不讲内部模块，只按用户真正会走的操作路径解释变化。

### 5.1 共享会话：一条对话可以轮流使用多个执行目标

典型路径：

```text
Claude / Official
  → Claude / OpenRouter
  → Codex / OpenAI
  → Claude / Official
```

体验变化：

- Sidebar 仍只有一个 Shared Session。
- 每个 Target 有独立 Hidden Binding。
- 切回旧 Target 时复用其 Binding。
- 只同步离开期间缺失的 delta，不重复灌完整历史。
- 某个 Provider 失败时，不静默 fallback 到另一个 Provider。
- Stop、Approval、AskUserQuestion、Recovery 发给真实 Owner。

### 5.2 原生会话：不在原会话里硬换 Provider，而是安全新建一条续接

典型路径：

```text
Claude Provider A 的旧 Session
  → 使用 Codex Provider B 继续
  → 得到新的 Codex Native Session
```

体验变化：

- 来源保持原样。
- 新 Session 有独立 Provider Binding。
- 新 Session 带来源关系，但不是来源的 child row。
- 删除来源不会级联删除新 Session。
- 可以回到来源查看原始上下文。

### 5.3 长会话切换：不再“能塞多少塞多少”，而是明确告诉你搬了什么

- 目标支持原生历史导入时，直接使用原生导入
- 不支持时，改用通用对话文本或结构化摘要
- Provider-private reasoning / signature 不泄漏到不兼容目标。
- Tool Call / Result 保持原子性。
- Image、超长 Tool Output 或不支持内容被省略时必须可见。
- 目标明确回复“已经收到”后，才记录第一段同步进度
- 本轮完成并安全记账后，才记录第二段完成进度

### 5.4 失败体验：不再靠“再点一次试试”，而是告诉你卡在哪

用户应能区分：

- Reader 不支持或没有 stable cursor。
- source history 损坏或权限不足。
- Context compile 失败。
- 需要确认 degraded context。
- Provider 不可用。
- target creation / acceptance ambiguous。
- artifact integrity failure。
- catalog metadata commit 失败。

其中 ambiguous 与 integrity failure 必须 fail closed，不能通过重复点击创建第二个目标 Session。

## 6. 人工测试准备

人工测试不能只看“按钮点完有没有新会话”。还要确认来源文件没被改、没有重复创建、历史没有丢失、重启后能从正确位置恢复。

### 6.1 环境

准备：

- Claude Provider A：能正常创建会话、发送消息和读取历史
- Claude Provider B：用来测试共享会话换目标；如果 D 还不支持续接到 Claude，只验证系统能明确提示“不支持”
- Codex Provider A、B：使用不同的 `CODEX_HOME` 或 Provider 配置，并且都支持 AppServer
- Kimi Provider：能读取公开历史；如果系统无法证明读取边界稳定，预期结果就是明确提示“不支持”
- 一个开启 Shared V2 的测试 Workspace。
- 一个旧版 Legacy Shared Session。
- Claude、Codex、Kimi 各一条 Native Session。

测试历史至少包含：

- 普通 user / assistant text。
- Tool Call + Tool Result。
- 超长 Tool Output。
- Image / Attachment。
- Provider-private reasoning / signature。
- aborted / error Turn。
- 历史 control message。

### 6.2 观察面

每次测试不要只盯着界面。请同时检查六个地方：

1. 左侧会话栏：会话数量、层级、标签、来源导航。
2. 聊天内容区：历史顺序、本轮目标标签、Tool 执行、重复最终回复。
3. 输入框：执行目标、锁定状态、历史删减和恢复状态。
4. 后台 CLI 进程：真实目标 Provider 是否被启动。
5. 持久化数据：目标连接、同步进度、操作阶段和来源关系。
6. 重启后：是否恢复同一状态，而不是新建第二份。

对应的大白话：

1. 左侧到底多了几条会话，位置和标签对不对
2. 聊天内容有没有丢、乱序、重复，工具调用有没有只剩一半
3. 输入框显示的执行目标和状态是否准确
4. 后台真正启动的是不是你选择的 Provider
5. 系统保存的目标连接、同步进度和来源关系是否正确
6. App 重启后是接着做，还是又创建了一份重复会话

## 7. 人工测试矩阵与预期

这一章已经写成可以照着执行的测试清单。每项都给出步骤、正确结果和一眼判错的标准。

### 7.1 共享会话切换执行目标

#### MT-B00：Provider-aware 模型菜单可达性

步骤：

1. 打开一条 Shared Session，点击输入框底部当前模型。
2. 展开 `Claude Code`，确认能看到本地配置和所有 managed Provider 分组及各自模型。
3. 展开 `Codex CLI`，选择一个只属于 Codex Provider B 的模型。
4. 重新打开菜单，切回 Claude Provider A 的另一个模型。
5. 查看 `Kimi CLI`。

预期：

- 根菜单同时看到 Claude Code、Codex CLI、Kimi CLI。
- Claude/Codex 模型按 Provider 分组；选择后按钮立刻显示新模型和新 CLI 图标。
- 同名模型也按完整 `engine + providerProfileId + model` 命中，不串 Provider。
- “本地配置”不会在内部产生第二个伪 Provider Binding。
- Kimi 当前显示 disabled 原因，不被隐藏，也不能触发 silent fallback。
- 打开根菜单不拉取全部模型；只在展开具体 CLI 后加载该 CLI 的 Provider 模型。

失败判据：

- 只能看到当前 CLI 的默认 Provider 模型。
- 切换后按钮显示“选择模型”或仍显示旧 Provider/model。
- Kimi 完全不出现，或点击后偷偷改发 Claude/Codex。

#### MT-B01：同一 Shared Session 切换三个 Target

步骤：

1. 新建 Shared Session。
2. 使用 `Claude / Official` 发送一轮。
3. 切到 `Claude / Provider B` 发送一轮。
4. 切到 `Codex / Provider A` 发送一轮。
5. 切回 `Claude / Official` 再发送一轮。

预期：

- Sidebar 始终只有一个 Shared Row。
- 不出现三个 Native child row。
- 四个 Turn 的 Badge 分别保持当时的 Target。
- 切回 `Claude / Official` 复用首次 Binding。
- 第四轮只收到离开期间新增上下文。
- Canvas 不 remount、不闪空、不重复 Assistant Final。

失败判据：

- 当前 Picker 改写了历史 Badge。
- Sidebar 出现 Hidden Binding。
- 切回后完整历史被再次注入。
- Stop / Approval 发给错误 Provider。

#### MT-B02：任务运行时修改执行目标

步骤：

1. 启动一个长 Turn。
2. 在 streaming 期间尝试修改 CLI / Provider / Model。

预期：

- Picker 被锁定，或明确只允许独立的 Next Target 预选。
- 当前 `activeTurnTarget` 不改变。
- Interrupt 命中当前真实 Owner。

失败判据：

- 运行中 Target 被原地替换。
- 当前 Turn 的 Provider Badge 漂移。

#### MT-B03：已经绑定的 Provider 不可用

步骤：

1. 让已绑定 Provider 的凭证或 runtime 不可用。
2. 恢复 Shared Session 并尝试发送。

预期：

- Target 保留为 unavailable。
- 不静默回退 local/default 或其他 Provider。
- 历史仍可读。
- 错误包含目标 Provider 身份与恢复方向。

#### MT-B04：Shared 跨 CLI 终态、Stop 与重复回复

步骤：

1. 在 Shared Session 使用 Claude Code 发送一条短消息。
2. Claude typed final/result 到达后，观察 Composer 是否立即恢复 idle；不要等待 CLI process 或 hook 完全退出。
3. 切换到 Codex CLI 发送一条消息，再切回 Claude Code 发送一条消息。
4. 启动一个长 Turn，在运行中点击 Stop，然后继续发送下一轮。
5. 分别检查消息列表、Shared 状态条和 Sidebar 运行状态。

预期：

- Claude/Codex 都由 backend exact-Attempt waiter 以 durable settlement 收口。
- Provider typed final 到达后 Composer 正常结束；cleanup 仍可在后台完成。
- 每个 Attempt 只显示一条 Assistant Final，不因 cumulative/full observation 或迟到 terminal 重复回复。
- Stop 命中当前 Engine + Provider + Binding + Runtime Turn。收到 cancel ACK/typed cancellation 时结算为 `cancelled`；若 Provider completion 在取消生效前获胜，可以保持 `completed`，但最终只能有一个 outcome。
- 切换 CLI 不改变既有 Turn Badge，也不让前一个 Runtime 的迟到事件结束当前 Turn。
- 普通 Claude/Codex Native Session 的终态、Stop 与 recovery 行为保持不变。

失败判据：

- 已听到结束提示、已看到最终回复，但 Composer 仍长期显示 Stop。
- 出现 `blocking Claude Shared dispatch returned without typed run.settled` 一类前端猜测错误。
- 一轮出现两条相同 Assistant Final。
- Stop 无响应、停错 Provider，或 Stop 后下一轮仍被旧状态锁住。

当前证据：

- 2026-07-29 产品 owner 已验证 Shared Claude CLI/Codex CLI 交叉切换、切回与正常结束。
- Stop、duplicate terminal、late cleanup 与 Native 对照由 focused automated tests 覆盖。

### 7.2 换 Provider 时搬运历史

#### MT-C01：历史可以高完整度搬过去

步骤：

1. 构造包含 text、完整 Tool exchange 的短会话。
2. 从 Claude Target 切到支持 native import 的 Codex Target。

预期：

- 使用 `native-history-import`。
- JSON-RPC success 后才显示 accepted。
- Tool Call / Result 成对出现。
- 不需要 degraded confirmation。

#### MT-C02：历史太长，需要删减后再确认

步骤：

1. 构造超出目标预算的长会话，包含超长 Tool Output 和 Image。
2. 切换到不支持全部内容的 Target。

预期：

- 发送前展示 degraded confirmation。
- 明确列出 transformation / omission。
- 展示 before / after token 或等价压缩事实。
- 取消后不创建 pending delivery、不推进 cursor、不发送 prompt。
- 确认后才执行。

失败判据：

- 使用只有“是否继续”的空洞确认，用户看不到省略内容。
- 取消后仍创建目标 Session。
- Image 或 private reasoning 被静默丢弃。

#### MT-C03：Tool Call 和 Tool Result 刚好卡在长度上限

步骤：

1. 让 Tool Call 接近 Context budget 边界，Tool Result 超出边界。
2. 触发 compile。

预期：

- Tool Call / Result 成对保留或成对省略。
- 不出现只有 Call 没有 Result 的“成功”记录。
- 省略内容进入 Manifest。

#### MT-C04：目标已经收到历史，但后续执行失败

步骤：

1. 让目标明确 ACK Context。
2. 在目标 Run 完成前制造 runtime 失败。
3. 重试同一 Target。

预期：

- accepted cursor 不回退。
- 已接受 Context 不重复注入。
- committed cursor 等待真实 Terminal Fact。

### 7.3 从原生会话创建跨 Provider 续接

#### MT-D00：续接确认、标题与来源卡片

步骤：

1. 右键一条 Claude/Codex Native Session，选择“使用其他 Provider 继续”。
2. 在 mossx Dialog 中检查来源、目标后先点取消，确认没有新会话。
3. 再次进入并确认；若出现 degraded，检查 mode、token 和 omissions 后二次确认。
4. 打开新续接会话，观察 Sidebar 标题、消息区顶部的折叠摘要和消息内容。
5. 点击顶部“查看来源”。

预期：

- 全程不出现浏览器/系统 `alert` 或只有“确定/取消”的原生警告。
- 首次 Dialog 明确显示“来源会话 → 目标 CLI/Provider”；取消不产生 side effect。
- 新 Row 标题为“继续：来源标题”或明确的 Provider 续接标题，不显示 raw hash。
- 默认只显示一行“Provider 续接”摘要，不挤压或重排普通消息；展开后显示来源，
  按钮能回到来源；来源缺失时按钮禁用并给出解释。
- 若进入 recovery，主文案解释是否可能已创建；“重试校验”不产生第二个目标，
  raw error 只在折叠的“技术详情”中展示。
- 幕布中不显示 `MOSSX_CONTEXT_PACKAGE` / `MOSSX_CONTEXT_ACCEPTED`。
- 普通用户主动讨论 `MOSSX_CONTEXT_PACKAGE` 的消息不会被误隐藏。

#### MT-D01：Claude A → Codex B → 原 Claude A

步骤：

1. 在 Claude Provider A Native Session 右键。
2. 选择“使用其他 Provider 继续”→ `Codex · Provider B`。
3. 等待创建完成并打开新 Session。
4. 发送“请总结刚才的决定并继续下一步”。
5. 在新的 Codex Provider B Session 右键，选择“使用其他 Provider 继续”→
   `Claude · Provider A`。
6. 打开返回 Claude Provider A 的新 Session，再次让它总结来源链和当前决定。

预期：

- 来源 Claude Session 内容、Provider、文件均不变化。
- 创建一个新的 Codex Native Session。
- 新 Row 位于 Sidebar 顶层。
- 新 Row 显示“供应商续接”，不显示“子代理”。
- 新 Session 能正确引用来源历史。
- Provider Binding 为 Codex Provider B。
- `familyId` 继承；`lineageParentSessionId` 指向来源。
- `parentThreadId` 为空。
- 返回 Claude A 时创建第三条独立顶层 Session，不复用或改写第一条来源。
- 三条 Session 共用 `familyId`；第三条的 `lineageParentSessionId` 指向 Codex B，
  `lineageDepth` 再增加一。

#### MT-D02：Codex A → Codex B

步骤：

1. 在 Codex Provider A Session 选择 Codex Provider B。
2. 完成创建后分别检查 A、B 的 native history。

预期：

- 不复制 A 的 rollout file。
- 不修改 A 的 rollout file。
- B 是新 thread，通过 `thread/inject_items` 接受 portable history。
- 同 Provider A 不出现在“其他 Provider”候选中。
- 旧 `native-provider-rebind` / provider fork 不再承担跨 Provider 路径。

失败判据：

- 发现 vendor rollout copy。
- 新 Session 写入 `parentThreadId`。
- B 的历史文件冒充 A 的 native file。

#### MT-D03：Kimi 历史无法稳定读取时必须停止

步骤：

1. 对 Kimi Native Session 执行 Continuation。
2. 分别使用有 stable public history 和无法证明 stable cursor 的版本。

预期：

- 能证明 stable cursor 时，冻结到明确 byte / event boundary。
- 无法证明时返回 typed `unsupported-stable-cursor`。
- unsupported 时不写 materialization、不创建目标 Session。

#### MT-D04：来源历史需要删减后才能续接

步骤：

1. 来源历史加入目标不支持的 Image、private reasoning 或超长 Tool Output。
2. 创建 Continuation。
3. 首次选择取消，第二次确认。

预期：

- 取消：无目标 side effect。
- 确认：使用已冻结的同一 materialization，不重新读取漂移来源。
- UI 展示具体 omission，而不是只有笼统警告。
- Continuation 创建完成后 provenance 可追溯。

#### MT-D05：重复点击与幂等

步骤：

1. 快速双击同一 Provider 候选。
2. 在网络慢或 Runtime 启动慢时重复触发。
3. 使用同一 `operationId` 重试。

预期：

- 同一 source operation 同时只执行一次。
- 重试复用 immutable materialization。
- 同一 `operationId` 请求内容变化时返回 `operation-conflict`。
- 最终最多一个目标 Session。

#### MT-D06：创建过程中 App 崩溃

分别在以下时间点强制退出 App：

1. materialization 前。
2. materialization commit 后、target creation 前。
3. target identity 产生后、history ACK 前。
4. history ACK 后、catalog metadata commit 前。

预期：

| 崩溃点 | 重启后预期 |
| --- | --- |
| materialization 前 | 没有 durable operation，不存在目标 side effect |
| prepared 后 | 复用冻结 artifact，允许安全继续 |
| 已经拿到目标会话编号，但目标还没确认收到历史 | 标记为“需要恢复 / 接收结果不确定”，禁止盲目创建第二个 |
| ACK 后、catalog commit 前 | 复用 target identity，只重试 metadata commit |

#### MT-D07：冻结的历史材料被损坏

步骤：

1. 准备完成后，人为损坏“统一历史条目”或“上下文包”文件。
2. 使用相同 operation 重试。

预期：

- checksum 检查失败。
- operation 进入 `recovery-required`。
- 不读取漂移来源重新伪造相同 operation。
- 不创建新 target。

#### MT-D08：来源导航

步骤：

1. 从 Continuation Row 选择“查看来源会话”。
2. 再删除或归档来源 Session，重复操作。

预期：

- 来源存在时准确打开来源。
- 来源缺失时给出可理解反馈，不跳到错误 Session。
- Continuation 保持可见、可打开、可恢复。
- 删除来源不级联删除 Continuation。

#### MT-D09：续接会话不能冒充子代理

步骤：

1. 同时准备一个真实 Subagent Session 和一个 Provider Continuation。
2. 刷新 Sidebar、重启 App、重新加载 catalog。

预期：

- Subagent 嵌套并显示“子代理”。
- Continuation 顶层显示“供应商续接”。
- 两者不会在 metadata 延迟到达时互相闪现。

### 7.4 桌面端与后台服务行为一致

#### MT-X01：本地与 remote backend

步骤：

1. Desktop 本地模式执行一次 Continuation。
2. remote backend / daemon 模式执行同一类请求。

预期：

- command 名和 camelCase payload 一致。
- Desktop 创建成功。
- daemon 明确返回 `unsupported-target-acceptance`，不创建目标、不 fallback。
- remote adapter 具备 Native History/Artifact owner 前，不得把 typed unsupported 改成伪成功。

### 7.5 老会话兼容与界面性能

#### MT-X02：Legacy Shared Session

步骤：

1. 打开升级前 Shared Session。
2. 开关 V2 DataSource。
3. 继续发送一轮。

预期：

- 旧 history 顺序与内容保持。
- 缺失 protocol facts 不被伪造。
- 旧 snapshot 不被回写改造。
- 新 Turn 按 V2 boundary 追加。

#### MT-X03：后台 Binding 与根渲染

步骤：

1. 打开 React render attribution。
2. 让 Shared Hidden Binding 在后台运行。
3. 关闭其 Canvas，观察 AppShell / Sidebar。

预期：

- 无秒级轮询引发的根渲染。
- 后台 Binding 更新不持续命中 Canvas selector。
- streaming 正文继续走 `liveAssistantTextChannel`。
- 不出现逐 delta root dispatch。

#### MT-X04：Shared 历史恢复、改名与 recovery owner 隔离

自动故障注入准备：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test shared_projection
npx vitest run \
  src/features/threads/loaders/sharedHistoryLoader.test.ts \
  src/features/threads/hooks/useThreadActions.shared-history.test.tsx \
  src/features/messages/components/Messages.history-loading.test.tsx
```

这些测试在临时数据或 mock boundary 中覆盖 type-less row、type conflict、合法空 Projection、
Legacy 有/无内容和 Shared/Native recovery 对照。禁止为了人工验收直接修改正在使用的
Shared SQLite 数据库或 checksum。

Desktop 非破坏性步骤：

1. 打开一条已有多轮历史的 Shared Session，记录其 `shared:<UUID>`、标题、消息数量和最后一轮 Badge。
2. 修改标题，或发送首条消息触发标题推导。
3. 切换到其他会话再切回，然后重启 App 并再次打开该 Shared Session。
4. 对照 `shared:<UUID>`、消息数量、顺序、最后一轮 Badge 和恢复 UI。

预期：

- 改名前后始终按同一个 `shared:<UUID>` 加载，历史顺序、内容和 Turn provenance 不变。
- Rust harness 证明新写入 delivery row 同时包含 row `fact_type` 与 payload tagged `type`。
- Rust harness 证明旧 type-less object row 可以在不改写 payload/checksum 的前提下重建。
- Rust harness 证明 embedded type conflict 或非 object payload 返回 typed projection error，不猜测修复。
- Frontend tests 证明 Legacy 有实际内容时允许 presentation fallback；Legacy 为空时保持 retryable error。
- Frontend tests 证明合法空 Shared Session 可以正常 loaded，不与 projection error 混淆。
- Shared failure 不调用 Claude/Codex Native resume，不显示“当前会话需要恢复”Native 卡片。
- Native Session 继续保留自己的 recovery card 和 retry action。

失败判据：

- 标题变化后加载另一份历史、空幕布或错误 cache scope。
- 自动测试失败，或 Projection error 被当成成功空数组后不再重试。
- Shared Canvas 出现 Native recovery card，或点击恢复后操作 Hidden Native Session。
- Desktop 改名/重启后 `shared:<UUID>`、消息数量、顺序或最后一轮 Badge 变化。

证据留存：

- 保存两条自动化命令的通过摘要。
- 保存改名前、改名后切回、重启后各一张包含 Sidebar 标题与最后一轮消息的截图。
- 记录同一个 `shared:<UUID>`；不要记录或提交真实 Provider credential、完整本地数据库。

## 8. 发布前硬门槛

大白话：下面这些问题不是“小瑕疵”。只要出现一个，就不应该发布 A–D。

以下任一失败都应阻断 A–D rollout：

- 同一轮出现两条重复的 Assistant 最终回复
- Provider 已返回 typed final，但 Shared Composer 仍等待 process/hook cleanup
- Shared Stop 没有命中 exact Attempt，或取消后仍保持运行锁
- Tool Call 和 Tool Result 只剩一半
- 某个 Provider 的私有 reasoning 或 signature 泄漏给不兼容的 Provider
- 历史已经被删减，但没有经过用户确认就发送
- 系统不知道目标是否收到，却又创建了第二个隐藏会话或续接会话
- 复制、修改或回写 Claude、Codex、Kimi 自己的历史文件
- 续接会话写入 `parentThreadId`，或者被显示成 Subagent
- 删除来源会话时，把续接会话一起删除
- Provider 失败后偷偷切换到其他 Provider
- Shared 模型菜单无法选择其他 Provider 的真实模型，或切换后仍显示旧 Target
- 续接确认使用 native Alert，或取消后仍创建目标
- Sidebar/幕布直接展示 `MOSSX_CONTEXT_*` hash，或无法从续接会话返回来源
- Shared projection error 被伪装成正常空历史，或 Shared 进入 Native recovery/card
- Shared 标题变化后使用不同 history/cache/recovery key
- 新 Canonical Fact 缺少 tagged `type`，或 row `fact_type` 与 payload type 冲突仍被接受
- 流式文字每来一小段就触发整个 AppShell 更新
- 后台隐藏会话让 AppShell 持续重复渲染

建议发布证据至少包含：

- Change D 定向 Rust tests。
- Change D frontend component / hook / DTO tests。
- TypeScript typecheck 与 scoped ESLint。
- Desktop / daemon command parity。
- OpenSpec strict validation。
- 本文 MT-B01、MT-B04、MT-C02、MT-D01、MT-D02、MT-D06、MT-D09、MT-X03、MT-X04 的人工记录。

## 9. 当前不足点

这一章专门说“现在还差什么”。A、B、C 已通过自动化验收，不代表 D 已经完整，也不代表真实 CLI 版本下没有兼容问题。

### 9.1 产品能力不足

1. **Kimi target 与 remote daemon 暂未执行 Continuation。**

   Desktop 已支持 Claude completed bootstrap/durable recovery evidence 与 Codex structured inject。Kimi target 和 remote
   daemon 在能力无法证明时返回 typed unsupported。

   大白话：桌面端可以在 Claude 和 Codex 之间双向续接；Kimi 和远程后台不会假装成功。

2. **“使用其他 Provider 继续”目前只是 Sidebar 右键子菜单。**

   当前没有完整的 CLI、Provider、Model、Reasoning 选择对话框，也不会在选择前解释目标支持什么、历史能保留多少、预计删减什么。

3. **历史有删减时已改用 Desktop 原生确认框，但还不是结构化详情页。**

   `window.confirm` 已替换为 Tauri Dialog，解决 macOS WKWebView 静默返回 `false`；
   mode、token estimate、omission 与 adapter drop 仍以文本展示。

   大白话：三平台现在都能确认或取消，但内容很多时还不够好读。

4. **失败恢复没有正式用户入口。**

   backend 有 `recovery-required` 语义，但普通用户缺少“查看失败原因 / 继续恢复 / 放弃 operation”的管理面。

5. **来源会话不存在时，反馈仍较轻。**

   当前入口会显示“来源不可用”并禁用，不会误跳到其他 Session；但还没有包含删除、归档或
   Catalog 不完整原因的正式诊断面板。

6. **系统记录了会话家族，但界面还没有家族视图。**

   第一阶段 Continuation 顶层展示是正确边界，但多次续接后 Sidebar 会缺少 Family 聚合能力。

   大白话：A 续接出 B，B 又续接出 C 时，系统知道三者关系，但 Sidebar 仍显示三条平铺会话。

7. **换电脑后恢复冻结材料不在当前范围内。**

   在另一台设备恢复 Continuation operation 时，immutable artifact 可能不可用；当前设计明确未解决。

8. **自动化测试不能代替真实 CLI 版本测试。**

   `thread/inject_items`、Claude 回显确认、Kimi ACP 都会受 CLI 版本和协议变化影响，需要按真实版本逐个测试。

### 9.2 工程闭环不足

- Change D tasks 已完成 19/19；真实 Desktop smoke 仍是发布 gate。
- Shared Claude/Codex 交叉切换与终态已由产品 owner 验证，但 MT-B04 的 Stop 和 MT-X04
  故障注入仍应保留独立人工记录，不能只依赖正常路径。
- 2026-07-29 校准使用 focused suites；它证明本次 Shared contract，但不代表整个前端
  repository test suite 在任意 dirty worktree 下全部通过。
- A–D 生产校准的 focused automated tests 已纳入发布证据；Windows/Linux 由 native
  release CI 继续执行平台编译。macOS 上的 Windows cross-check 因缺少 Windows SDK
  C headers 停在第三方 `ring` build script，不记作代码通过或失败。
- Codex vendor rollout copy 与 `native-provider-rebind` 已从可达实现清退。
- catalog refresh、reload 后自动选中新 Row 存在真实运行时序风险，需要 Desktop smoke。
- 当前通用 runtime notice 不能完整表达 continuation typed error matrix。
- D UI 入口缺少明确 feature flag；而设计回滚要求“可隐藏 UI 入口并保留 metadata”。
- operation / artifact 的 retention、GC、磁盘增长和诊断入口尚未形成产品策略。
- A2 的独立 Event Log Inspector 仍未实现。
- Token 用量汇总、会话家族视图和多 Agent 状态视图尚未进入普通用户界面。

## 10. 接下来必须查什么

这章不是泛泛的“以后再优化”，而是列出发布和后续阶段前必须回答的问题。Change D
可在自动化闭环后归档，但 P0 人工证据未完成前不能发布。

### P0：A–D 发布前必须查清

| 调研项 | 要回答的问题 | 产出 |
| --- | --- | --- |
| Codex 导入版本矩阵 | 哪些 Codex 版本支持 `thread/inject_items`？能导入哪些消息？重复导入和重新读取会怎样？ | 按版本记录的能力表和发布门槛 |
| Claude 目标端终态与恢复 | 真实 Claude typed final 是否在 process cleanup 前稳定收口？replay echo 只作为 delivery/recovery evidence 时，失败后能否恢复同一 session？ | Shared MT-B04 与 Native Continuation Desktop smoke 记录 |
| Kimi 稳定历史和接收确认 | Kimi 的公开历史读取边界是否稳定？ACP 加载、发送、恢复、取消分别能提供多强的确认？ | 明确“支持 / 不支持”和错误类型 |
| 目标会话恢复 | 真实 Provider 断线后，重试是否准确找回同一个目标？ | recovery smoke 记录 |
| 来源身份 | 固定、分组、归档和老会话里的 catalog id、native id、provider id 是否都可靠？ | 真实 catalog smoke |
| 新会话刷新竞态 | 新会话创建后，“刷新列表”和“打开新会话”是否可能顺序颠倒？ | Desktop 操作记录和竞态测试 |
| 明确错误界面 | 读取、冻结材料、目标确认、目录保存失败后，界面分别显示什么和允许做什么？ | 错误类型到用户操作的对照表 |
| 功能开关和回滚 | 怎样隐藏新入口，同时保留已经创建的续接会话和来源信息？ | 发布与回滚方案 |

补充操作：在旧版 Codex 或不提供 `thread/inject_items` 的测试 runtime 上执行一次
Claude → Codex 续接。预期在创建目标 Thread 前自动选择 transcript/checkpoint，并弹出
Desktop degraded confirmation；取消后目标列表不新增会话。

### P1：A–D 发布前查

- source × target 真实 CLI 版本矩阵，不只用 fixture。
- 不支持 Image、reasoning、Tool Result 的目标端是否完整记录 omission。
- package prefix stability 在真实长会话中的字节级证据。
- ArtifactRef progressive retrieval 是否真的由目标显式触发。
- 30s 以上后台运行是否出现 AppShell / Sidebar render storm。
- Provider profile 删除、重命名、禁用后的历史与 recovery 行为。
- Legacy Shared Session 在 V2 打开后的继续发送与 fallback。
- SQLite corruption / read-only recovery 的真实用户提示。
- Continuation 多代 lineage：A→B→C 后 family root、parent、depth 是否稳定。
- operation / artifact GC 是否会提前删除仍需 recovery 的数据。

### P2：进入第五阶段“多 Agent 编排”前查

- 哪些 CLI 真正支持“运行中纠偏”，哪些只能等当前任务结束后再补充
- 并行 Agent 的 owner、approval、interrupt、budget、retry 如何隔离。
- 多 Agent 状态面板最少需要显示哪些数据
- `run.settled` 是否足以表达所有引擎的结束与失败。
- 任务调度是否需要持久化队列；禁止只把任务状态放在前端内存里
- 人工介入点：AskUserQuestion、Approval、Cancel、Retry 在多 Agent 下如何路由。
- 多 Agent 界面采用时间线、泳道还是关系图，第一版只能选一种
- 并行运行对 token / cost / rate limit 的预算与可见性。

### P3：进入第六阶段“插件与自动流程”前查

- Plugin manifest、capability negotiation 与版本兼容。
- Provider / Engine registration 的 ABI / RPC contract。
- secret / filesystem / network / process 权限模型。
- Plugin event hook 的 delivery、retry、backpressure、幂等。
- 外部 Engine 的 crash isolation 与 resource quota。
- Pipeline single / parallel / chain 的 durable state。
- DAG 的 cycle、fan-out、join、partial failure 与 cancellation。
- SDK 的认证、workspace boundary、remote parity 与 audit log。
- Marketplace governance、签名、更新、撤回和供应链安全。

## 11. Change D 之后的规划

现有正式规划只有 Phase 5 / Phase 6 的方向，尚未达到 implementation-ready，也没有对应 OpenSpec change。以下拆分是基于现有设计的建议，不是已经承诺的任务。

### 11.1 第五阶段：多 Agent 编排基础

目标：

> 让多个 Agent 或 CLI 围绕同一份会话事实协作，但不能各记各的账。

大白话场景：

```text
Claude 先分析需求
        ↓
Codex 接着修改代码
        ↓
另一个 Agent 运行测试
        ↓
Claude 汇总结论
```

四个参与者看到的是同一条会话事实。停止、审批、重试和补充要求必须发给正确的参与者。

建议拆为三个 Change：

#### Change E1：Orchestrator Projection

- 只读取 A2 已经安全保存的统一事实，不再新建第二套事实库。
- 整理每次运行、Agent、真实执行者、状态和依赖关系，供界面显示。
- 复用现有幂等 `run.settled`。
- 不建立第二个权威事件写入口。
- 不把前端内存里的状态当成真实调度状态。

预期 UI：

- Session 内可看到多个 Agent / Run 的状态。
- 明确区分 active、waiting input、approval、settled、failed。
- 第一版建议采用线性 timeline / lanes，不直接上完整 DAG。

#### Change E2：Control Delivery

- 定义三种控制：运行中纠偏、当前任务完成后接力、下一轮开始前预置输入。
- 根据 CLI 真实能力选择控制方式。
- CLI 不支持运行中纠偏时，降级为“结束后接力”，但界面必须说明。
- 每个控制都携带完整的会话、CLI、Provider、原生会话、运行和轮次身份。
- 审批、停止、重试和向用户提问不能发错 Agent。

预期体验：

- 用户可以在运行中纠偏、在结算后接力、为下一轮预置输入。
- 不同 CLI 能力不同时，UI 明确说明实际执行语义。

#### Change E3：Durable Orchestration

- 用持久化队列保存待执行任务和待发送控制。
- 支持崩溃恢复、取消、重试和“部分 Agent 成功、部分失败”。
- 同一 CLI 的不同 Provider 并行运行时互不串线。
- 使用事件更新状态，禁止每秒轮询。
- 限制 Token、费用和并发数量，并让用户看得到。

验收红线：

- Orchestrator 不反向定义 Canonical Fact。
- Shared / Native Canvas contract 不回退。
- Provider-scoped 并行不串 Owner。
- 后台 Agent 不制造根渲染风暴。

### 11.2 第六阶段：插件与自动流程

目标：

> 让外部开发者按统一规则接入新的 Provider、CLI 和自动化流程，但插件不能绕过核心会话规则。

大白话场景：

```text
第三方写一个新 CLI Adapter
        ↓
mossx 先检查它声明的能力和权限
        ↓
用户把它放进“分析 → 改代码 → 测试”的自动流程
        ↓
每一步仍使用 A–D 建立的会话、目标、上下文和恢复规则
```

建议顺序：

#### Change F1：Provider / Engine Registration

- 使用带版本的插件说明文件。
- 插件明确声明自己支持什么，mossx 验证后再启用。
- 检查数据格式、来源和重复注册。
- 明确密钥、文件、网络和进程权限。
- 插件崩溃不能拖垮主程序，并限制它使用的资源。

#### Change F2：Agent Event Hooks 与外部 RPC / SDK

- 定义事件怎样发给插件，失败怎样重试，插件处理不过来时怎样限流，重复事件怎样去重。
- 限制插件能访问哪个 Workspace，并验证调用身份。
- 记录可审计日志。
- Desktop、本地后台和远程模式保持相同行为。

#### Change F3：Pipeline

- 先支持单步和串行流程。
- 再支持并行执行和汇总结果。
- 每一步都使用稳定的执行目标和统一会话事实。
- 流程状态必须持久化，关闭界面后也不能丢。

#### Change F4：DAG

- 检查循环依赖。
- 支持一个任务拆成多路，再汇总成一路。
- 处理部分任务失败。
- 上游取消后，正确通知所有下游。
- 保存中间进度并继续恢复。
- 限制费用和并发。

禁止项：

- 先做 Plugin Market，再补 permission / runtime contract。
- 允许 Plugin 直接写 Canonical Event Storage。
- 用插件自定义字段替代“本轮执行目标”“会话来源”和“会话家族”这些核心契约。
- 用 frontend graph state 作为 pipeline truth。

### 11.3 推荐优先级

```text
先完成 D 的 Codex-target 产品闭环
        ↓
补齐 Claude target；Kimi 按 capability go / no-go
        ↓
做 1～2 个 release cycle 的真实恢复与长会话观测
        ↓
Phase 5：先 Projection，再 Control，再 Durable Orchestration
        ↓
第六阶段：先做插件注册和权限，再做事件接口与远程调用，最后做自动流程和任务关系图
```

不要在 D 刚完成后直接做完整任务关系图或插件市场。A–D 解决的是可信会话与上下文；多 Agent 编排还需要单独设计真实执行者、任务队列、费用预算、部分失败和人工介入规则。

## 12. 最终判断

A–D 完成后，mossx 的客户端定位会发生一次实质跃迁：

```text
当前：
多个 CLI 能在同一客户端被启动和管理

完成 A–D：
多个 CLI / Provider 能共享可信会话事实、
按 Turn 切换执行目标、
安全迁移上下文、
并从 Native Session 派生可追溯的 Provider Continuation

完成 Phase 5：
多个 Agent 能在同一会话事实之上被协调

完成 Phase 6：
外部 Provider、Engine 与 Pipeline 能通过受治理的扩展 contract 接入
```

真正的竞争力不是“支持多少 CLI”，而是：

- 会话事实只有一个权威来源。
- 每一轮执行目标可追溯。
- 跨 Provider 上下文交付可解释、可恢复。
- Native history 所有权不被破坏。
- 新 CLI 按 Adapter contract 接入，而不是继续堆条件分支。

Shared Session 的 Claude → Codex → Claude 正常交叉切换已于 2026-07-29 通过产品 owner
验证。当前最重要的下一步不是继续扩功能，而是补齐 MT-B04 Stop、MT-X04 故障恢复记录，
并独立完成 Native Provider Continuation 的 Claude A → Codex B → 原 Claude A Desktop
smoke。Kimi target 继续保持 capability gate。

## 13. 核对范围

**Refers to：**

- `docs/research/mossx-multi-cli-provider-session-foundation-design.md`
- `docs/research/mossx-new-cli-onboarding-guide.md`
- `docs/plans/2026-07-27-multi-cli-provider-session-foundation-task-checklist.md`
- `openspec/changes/archive/2026-07-28-add-native-provider-continuation/**`
- `openspec/changes/archive/2026-07-28-calibrate-multi-cli-session-foundation-a-d/**`
- `openspec/changes/archive/2026-07-27-{establish-shared-event-storage,assemble-shared-canonical-facts,project-shared-canonical-conversation}/**`
- `openspec/changes/archive/2026-07-28-{compose-shared-session-execution-target,add-shared-context-compiler}/**`
- `openspec/changes/fix-shared-terminal-recovery-i18n/**`
- `openspec/changes/fix-shared-canonical-history-recovery/**`
- `src-tauri/src/shared_event_log/**`
- `src-tauri/src/shared_projection/**`
- `src-tauri/src/shared_context/**`
- `src-tauri/src/shared_session_v2.rs`
- `src-tauri/src/native_history/**`
- `src-tauri/src/native_continuation/**`
- `src/features/shared-session/**`
- `src/features/app/hooks/useSidebarMenus.ts`
- `src/features/app/components/ThreadList.tsx`

**Impact：**

- 本文同步记录 A–D 实现现状、2026-07-29 Shared 生产回归校准与发布前人工测试计划。
- Shared Claude/Codex 正常交叉切换已验证；Stop/故障恢复仍保留独立记录要求。
- Change D 自动化闭环已验证；Native Provider Continuation Desktop smoke 明确保留为独立发布 gate。
