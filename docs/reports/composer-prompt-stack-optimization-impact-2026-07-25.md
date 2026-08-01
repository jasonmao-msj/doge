# 输入与提示词体系优化项 · 逐项影响明细

> **2026-08-01 生命周期校准**：Historical Closure Evidence。四批 commit 仍用于追溯；当前 Composer 行为须从 `ComposerContextMenuPopover.tsx`、相关 hooks 与 OpenSpec 重扫。
> **日期**：2026-07-25（**2026-07-26 复核更新**：四个批次全部落地，逐项状态见下；**同日二次复核** @ `713ef5f2c`：9 项状态定性不变，`296fad4a5` 并发边界加固与 hash 漂移已同步）
> **基线**：分支 `feature/v-799` @ `c75922dec` → **当前复核**：分支 `feature/v-0710` @ `713ef5f2c`
> **来源**：从 `client-aux-modules-governance-report-2026-07-25.md` 摘出你选定的 9 项，逐项展开"现状 → 影响 → 处理后影响 → UI 变化"
> **核对方法**：逐项对照当前 HEAD 源码与生产 caller；你贴的清单里有两项状态已过时，本文按当前事实修正并显式标注
> **行号声明**：行号为 `c75922dec` 快照，后续提交请按 symbol 搜索
>
> **2026-07-26 落地批次**（与文末"实施顺序建议"四批一一对应；hash 为 rebase 后当前分支上的值，原 `9f969c0a5`/`81d9a47f9`/`5a76671b3`/`bee87c4f8` 一一对应）：
>
> | 批次 | 提交 | 覆盖项 |
> |---|---|---|
> | 批次1 纯清理 | `9484986c8` refactor(composer): 裁剪 Composer 层补全死路径与 ComposerInput 残留 | #1、#3 |
> | 批次2 行为一致性 | `32092503c` refactor(composer): 统一输入历史存储并事件化命令目录刷新 | #2、#5 |
> | 批次3 体验升级 | `85bc82b7e` feat(composer): 润色器本地化缓存与 curated skills 事件化刷新 | #7（部分）、#8 |
> | 批次4 增量能力 | `7173c9c5f` feat(composer): 技能调用契约与对话命令沉淀 | #6（契约部分）、#9（prompt 通道） |
> | 加固 | `296fad4a5` fix(composer): 修复提交生成与命令并发边界 | #5、#7 的并发健壮性（不改变状态定性） |

---

## 总览

| # | 优化项 | 优先级 | 真实状态（2026-07-26 复核） | UI 变化 |
|---|---|---|---|---|
| 1 | `ComposerInput.tsx` 死实现 | P0 | ✅ **已完成**（批次1：注释与测试命名残留已清） | 无 |
| 2 | 输入历史三套并存、发送时双写 | P0 | ✅ **已完成**（批次2：单一 store、单写） | 无（行为一致性修复） |
| 3 | 自动补全两套引擎同时跑 | P0 | ✅ **已完成**（批次1：976→88 行，死引擎已砍） | 无（纯性能/维护） |
| 4 | slash/prompt bridge no-op 死链路 | P0 | ✅ **已清**（批次前已完成） | 无 |
| 5 | 自定义命令 15s 冷却 + 全局兜底 | P1 | ✅ **已完成**（批次2：fs watch + 失败显式化） | **有**（命令列表更准确） |
| 6 | 技能调用纯文本拼接 | P1 | 🔶 **部分完成**（批次4：结构化契约已下发，`args` 通道预留待协议演进） | **有**（参数面板可选，未做） |
| 7 | prompt enhancer 粗糙 | P1 | 🔶 **部分完成**（批次3：本地化 system prompt + LRU 缓存；流式/就地 diff/错误码分类未做） | **有**（最大 UI 变化项，部分落地） |
| 8 | curated-skills 重型基础设施 | P1 | 🔶 **事件化完成**（批次3：2s 轮询→事件驱动+60s 兜底）；扩容/降级产品决策未做 | 基本无 |
| 9 | 对话→prompt/skill 一键沉淀 | P2 | 🔶 **部分完成**（批次4："存为 Prompt"已上线；"存为 Skill"未做） | **有**（新增入口） |

---

## 1. `ComposerInput.tsx` 1641 行死实现未删

**2026-07-26 复核**：✅ **已完成**（批次1 `9484986c8`）。两处残留均已清理：`ChatInputBoxAdapter.tsx` 头部注释已移除 ComposerInput 迁移叙事；guard test 已重命名为 `ChatInputResponsiveness.guard.test.ts`。本项关闭。

**原状态（07-25）**：原清单写"未做"，但当前 `src/` 下该文件**已删除**（治理报告 07-25 复核亦确认 ✅）。残留物只有两个：

- `src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.tsx:5` 注释仍自述 *"enabling drop-in replacement of ComposerInput"* —— 迁移叙事残留，会误导后来者以为还有个被替换对象存在。
- `src/features/composer/components/ComposerInputResponsiveness.guard.test.ts` 测试夹具仍沿用旧命名。

### 现状

旧 JCEF 时代的输入框实现本体已不进产物、不进打包。剩下的只是"考古线索"级别的命名残留。

### 影响什么

- ~~安装包更大~~ —— 已不成立，文件已删。
- AI 协作者/新维护者读到 adapter 注释，仍可能去搜一个不存在的目标文件，浪费定位时间。

### 处理后的影响

- 删掉/改写 adapter 头部注释，重命名 guard test。纯文档级清理，**零行为变化、零回归风险**。

### UI 变化

**无**。用户不可见。

### 建议降级

从 P0 降为 **P3 清理**，可随手做掉，不值得单独立项。

---

## 2. 输入历史三套并存、发送时双写

**2026-07-26 复核**：✅ **已完成**（批次2 `32092503c`，OpenSpec: composer-input-history）。`usePromptHistory.ts`（245 行）与旧版 `useInlineHistoryCompletion.ts`（169 行独立实现）已删除，`useInputHistoryStore` 成为唯一实现；`Composer.tsx` 中 `recordHistory` 双写调用已移除，发送时单写。历史数据按设计取舍（见该 change 的 design.md）。本项关闭。

**2026-07-26 二次复核修正**：`useInlineHistoryCompletion.ts` 后续在 `0e56bb3a6` 以新实现重建（现 167 行），但它是统一 store 的**只读消费者**（`loadHistoryItems`/`loadHistoryCounts` 均 import 自 `useInputHistoryStore`），被 `ChatInputBox.tsx` 与 `TaskCreateModal.tsx` 使用——"单一 store"结论不受影响。

**原状态（07-25）**：❌ 未做（双写仍在）。以下证据为 `c75922dec` 快照存档：

### 现状（证据）

- `src/features/composer/components/Composer.tsx:39` 同时 import 两套历史实现：`usePromptHistory` 的 `recordHistory` 和 `useInputHistoryStore` 的 `recordHistory`（别名 `recordInputHistory`）。
- `Composer.tsx:1447-1448` 与 `:1464-1465` 发送时**连续调用两次**，同一段文本写进两个 store：
  ```ts
  recordHistory(trimmed);
  recordInputHistory(trimmed);
  ```
- 两套 store 各自的容量、去重、持久化策略独立演化；补全/历史搜索/上箭头回溯分别读不同来源。

### 影响什么

- **口径不一致**：你在输入框按 ↑ 翻到的历史，和补全下拉里提示的历史，可能不是同一套排序/去重结果。
- **双份存储**：每条发送的 prompt 存两遍，持久化体量翻倍。
- **维护陷阱**：改历史行为（比如加"按 workspace 隔离"）要改两处，漏一处就是隐性 bug。

### 处理后的影响

- 收敛为单一实现（建议保留 `useInputHistoryStore`，`usePromptHistory` 改为薄适配或直接删），发送时单写。
- 历史、补全、搜索三处读同一事实源，行为口径天然一致。
- 风险点：两套 store 的历史数据迁移——需要决定是合并去重还是任选其一保留，这是本项**唯一有数据语义的决策点**。

### UI 变化

**无直接 UI 变化**。间接效果：↑ 键回溯与补全建议的排序/内容变得一致，"偶尔翻不到刚发过的那句话"这类玄学问题消失。

---

## 3. 自动补全两套引擎同时跑

**2026-07-26 复核**：✅ **已完成**（批次1 `9484986c8`，OpenSpec: prune-composer-autocomplete-dead-paths）。`useComposerAutocompleteState.ts` 从 976 行瘦身为 **88 行**的 trigger 上下文检测器，被弃用的记忆/便签 IPC、文件打分、item 构建与 `apply`/`handleInputKeyDown` 死输出全部删除；唯一消费者已消失的 `useComposerAutocomplete.ts`（279 行）同步删除；测试已同步收敛。每次键入不再白跑一轮记忆 IPC 与文件打分。本项关闭。

**原状态（07-25）**：❌ 未做。以下证据为 `c75922dec` 快照存档：

### 现状（证据）

- **第一套（被丢弃）**：`src/features/composer/hooks/useComposerAutocompleteState.ts`（980 行）在 `Composer.tsx:1034` 被调用，但其解构出的核心输出被**下划线弃用**：
  - `Composer.tsx:1030` `applyAutocomplete: _applyAutocomplete`
  - `Composer.tsx:1031` `handleInputKeyDown: _handleInputKeyDown`
  - `Composer.tsx:1054` `handleHistoryKeyDown: _handleHistoryKeyDown`
  - 即：980 行 hook 内部的文件/agent/skill 打分、记忆查询（`:296` 起 120ms 防抖的 `projectMemoryFacade.list` 请求）**照常执行**，结果大部分被扔掉。
- **第二套（实际生效）**：`ChatInputBox.tsx` 内 **7 个独立 `useCompletionDropdown` 实例**（`:432` file、`:480` memory、`:504` noteCard、`:529` command、`:557` skill、`:586` agent、`:654` prompt），各自独立做 trigger 解析、打分、渲染。

### 影响什么

- **性能浪费**：每次键入，第一套引擎的记忆查询、文件打分白跑一遍——纯 CPU/IPC 空转。
- **行为漂移风险**：两套 trigger 解析逻辑（何时弹、匹配什么）各自演化，同一输入在 Composer 层和 ChatInputBox 层判定可能不同。
- **维护成本**：修补全 bug 要先判断"用户看到的是哪一套算的"。

### 处理后的影响

- 砍掉 `useComposerAutocompleteState` 被弃用的输出与内部死计算，只保留 ChatInputBox 实际消费的字段（`handleTextChange`/`handleSelectionChange` 等仍在用的）。
- 980 行预计可瘦到 200~300 行；每次键入少一轮记忆 IPC 与文件打分。
- 风险点：需逐字段核对哪些输出**真的**没人用（测试里有消费者，见 `useComposerAutocompleteState.test.tsx`），删前先把测试同步收敛，避免"测试引用死 API"造成假活。

### UI 变化

**无**。用户看到的补全行为不变（第二套引擎本来就在干活），只是后台不再白算一份。

---

## 4. slash/prompt bridge no-op 死链路

**状态**：✅ **已清**（治理报告确认，`sendBridgeEvent` 恒 false 的链路已删除）。

### 现状

约 700 行"前端 → JCEF bridge → window.updateSlashCommands"的死链路已移除，无残留 caller。

### 影响 / 处理后影响

- 维护者不再会被一条"看起来在同步 slash 命令到 WebView"的假链路误导。
- 本项**无需再做任何事**，列入仅作存档对照。

### UI 变化

**无**（链路本来就是 no-op）。

---

## 5. 自定义命令空结果 15s 冷却 + 全局兜底启发式

**2026-07-26 复核**：✅ **已完成**（批次2 `32092503c`，OpenSpec: claude-commands-fs-watch / composer-command-completion）。全部四个问题点均已处理：

1. **15s 冷却 + 空爆发重试已删除**——`EMPTY_CLAUDE_COMMANDS_RETRY_COOLDOWN_MS`/`lastEmptyBurst` 逻辑不复存在。
2. **全局兜底已删除**——空结果即显示空，不再 `getClaudeCommandsList(null)` 冒充。
3. **失败显式化**——请求失败与空结果分离：失败时 `reportCommandsFailure` 推送 error toast（`chat.commandsListUnavailable*`，已配 10 语言文案），`commandsError` 随 hook 导出。
4. **fs watch 已上线**——Rust `claude_commands_watch.rs` 监视 `.claude/commands/` 目录，变更去抖后发 `claude-commands-changed` 事件触发即时刷新；另保留 **60s 可见性门控兜底轮询**（符合"禁秒级轮询"红线）。

**2026-07-26 二次复核补充**（加固提交 `296fad4a5`，不改变状态定性）：watch registry 从"contains 即跳过 / stop 即 abort"改为**租约计数**（同一 workspace scope 多消费者挂载时，stop 仅在最后一个租约释放后 abort watcher），并修复 start 路径两次取锁的 TOCTOU 竞态；前端 cleanup 改为等待 startPromise resolve 后再 stop，消除快速卸载导致的 watcher 泄漏。`claude_commands_watch.rs` 现为 363 行。

本项关闭。以下证据为 `c75922dec` 快照存档：

**原状态（07-25）**：❌ 未做（冷却与兜底逻辑仍在）。

### 现状（证据）

`src/features/commands/hooks/useCustomCommands.ts:120-166`：

1. 向 server 请求 `commands/list`，结果为空时进入 **15 秒冷却**（`EMPTY_CLAUDE_COMMANDS_RETRY_COOLDOWN_MS`，按 workspace 记 `lastEmptyBurst`）。
2. 冷却允许时**原地重试一次**；重试仍为空，就**降级拉全局命令列表**（`getClaudeCommandsList(null)`）兜底展示。
3. 整个失败路径 `fallback: () => []` **静默吞错**——server 挂了和"真的没有命令"在 UI 上无法区分。
4. 无 fs 感知：你往 `.claude/commands/` 加了文件，列表不会自己刷新，要等下一次触发。

### 影响什么

- **张冠李戴**：全局兜底会把**别的 workspace 才有/当前 workspace 不可用**的命令展示给你，点了才发现用不了。
- **故障隐身**：server 出错时你以为是"这个 workspace 没配命令"，实际是请求挂了。
- **新鲜度差**：新建命令文件后最长要手动触发才出现。

### 处理后的影响

- 加 fs watch（`.claude/commands/` 目录变更 → 失效缓存重新拉取），命令列表随文件系统实时更新。
- 失败显式化：请求失败与空结果分开呈现（如"命令服务暂不可用"vs"暂无自定义命令"），去掉静默 `fallback: []`。
- 删除或收敛全局兜底：空结果就显示空，不再拿全局列表冒充。
- 风险点：fs watch 需遵守仓库红线"事件驱动 + ≥30s 兜底轮询，禁秒级轮询"。

### UI 变化

**有，三处**：

1. 命令补全列表**变准**——不再出现别的工作区的命令。
2. server 故障时从"静默空列表"变为**可见的错误/降级提示**。
3. 新增 `.claude/commands/*.md` 后，补全列表**自动出现新命令**，无需重启或手动刷新。

---

## 6. 技能调用纯文本拼接

**2026-07-26 复核**：🔶 **部分完成**（批次4 `7173c9c5f`，OpenSpec: composer-skill-invocation-contract）。

已落地：
- 结构化契约已定义并贯通双端：`SkillInvocation { name, args? }`（`src/types/conversation.ts:424`）随 `MessageSendOptions.skillInvocations` 下发；`assembleSkillInvocations`（`promptAssembler.ts`，当前 :67，行号有漂移）与 `toSlashToken` 同一归一化规则生成；Rust 侧 `engine/commands.rs:1451` 接收并透传 `skill_invocations`。
- 文本拼接保留为协议载体/降级展示，不再是唯一通道。

未落地：
- `args` 通道当前**恒为空**（类型注释明示"引擎侧解析属后续协议演进"）。
- 参数校验、带表单的技能调用 UI 未做——需等待 engine 侧解析协议落地后再立项。

**原状态（07-25）**：🔶 部分变化。旧 `SkillsSection.tsx`（1289 行）已随 `b1d94a930` 删除，Skills UI 迁入 Extensions/Skills Hub；但调用层的文本拼接问题原样保留。以下证据为快照存档：

### 现状（证据）

- `src/features/composer/utils/promptAssembler.ts:42-55` `assembleSinglePrompt`：把选中的 skill 变成 `/skill-name` 纯文本 token，**直接拼在用户输入前面**发出去：
  ```ts
  return `${tokens.join(" ")} ${userInput}`;
  ```
- 无任何结构化参数通道：skill 需要什么参数、本次调用传了什么值，AI 只能从这段拼接文本里**自行猜测**。

### 影响什么

- **AI 理解靠猜**：多个 skill 连拼时，参数归属模糊（`/skill-a /skill-b 帮我部署` —— "部署"是谁的参数？）。
- **无法校验**：客户端不知道 skill 声明的入参 schema，拼错了也只能等 AI 端失败。
- **扩展天花板**：未来想支持"带表单的技能调用"（填参数再执行），纯文本协议接不住。

### 处理后的影响

- 定义技能调用契约（结构化 `skillInvocations: [{name, args}]` 随消息下发，文本拼接仅作降级展示）。
- 编译期可校验参数；UI 可为带参 skill 渲染参数表单。
- 风险点：牵涉 engine 双端协议演进（前端发、引擎侧解析），是 9 项里**协议成本最高**的一项，建议与 P2-8 合并立项。

### UI 变化

**有（可选渐进）**：

- 最小改动版：UI 不变，仅协议层结构化。
- 完整版：选中带参数的 skill 时弹出**参数填写面板**（而非手敲），发送预览里 skill 调用显示为结构化卡片而非裸文本。

---

## 7. prompt enhancer 粗糙

**2026-07-26 复核**：🔶 **部分完成**（批次3 `85bc82b7e`，OpenSpec: composer-prompt-enhancer）。四个粗糙点中两项已修、两项保留：

| 粗糙点 | 状态 |
|---|---|
| 英文硬编码 system prompt | ✅ **已修**：`resolveEnhancerLocale`（`usePromptEnhancer.ts`，当前 :143，行号有漂移）按界面语言 zh/en 生成润色指令，中文语境优化已落地 |
| 每次新建 session、无缓存 | ✅ **已修**：LRU 结果缓存（`enhancerResultCache`，上限 20 条淘汰），同一文本二次润色秒回零 token |
| 子串匹配错误分类 | ❌ **仍在**：仍用 `normalized.includes(needle)` 匹配错误文案 |
| 阻塞式弹窗、无流式 | ❌ **仍在**：`PromptEnhancerDialog.tsx` 保留，无流式输出、无就地 diff |

**2026-07-26 二次复核补充**（加固提交 `296fad4a5`）：缓存 key 已从 `locale|engine|model|text` 扩展为 **`workspaceId|locale|engine|model|text`**，修复跨工作区缓存串味；新增 workspace 切换保护——切换工作区时使在途润色请求失效并重置弹窗/加载/结果状态，防止上一工作区的异步结果落入新工作区。

剩余工作建议单独立项：流式输出 + 就地 diff 替换 + 错误分类结构化（用引擎错误码替代文案子串）。

**原状态（07-25）**：❌ 未做（全部四个粗糙点仍在）。以下证据为 `c75922dec` 快照存档：

### 现状（证据）

`src/features/composer/components/ChatInputBox/hooks/usePromptEnhancer.ts`（501 行）：

1. **子串匹配错误分类**（`:150-154`）：用 `message.includes(needle)` 匹配错误文案判断错误类型，引擎改一句措辞分类就失效。
2. **阻塞式弹窗**：`PromptEnhancerDialog.tsx`（235 行）整段等待结果，超时按 `normalizeEnhancerTimeoutSeconds`（`:116-122`）走，默认上限量级为 60s——点完"润色"就干等。
3. **英文硬编码 system prompt**（`:37`）：`'You are a prompt rewriting assistant.'`，对中文输入的润色指令没有任何中文语境优化。
4. **每次新建隐藏 session、无缓存**（`:17-18` `sessionPurpose: 'prompt-enhancer'` + `visibility: 'hidden'`；`:415` `buildIsolatedSessionId()`）：同一段文本润色两次，就付两次 token、等两次。

### 影响什么

- **中文用户干等一分钟**：阻塞弹窗 + 无流式，等待感极差；超时后只有一句英文报错。
- **错误处理脆弱**：网络错误/超时/引擎错误靠文案子串区分，误分类就把"重试即可"显示成"不可重试"。
- **token 浪费**：隐藏 session 一次一建，无结果缓存。

### 处理后的影响

| 改动 | 效果 |
|---|---|
| 流式输出 | 润色结果逐字出现，首字延迟从几十秒降到秒级 |
| 就地 diff 替换 | 在输入框内直接看到改动高亮，接受/撤销，而不是弹窗整体替换 |
| system prompt 随界面语言走 | 中文输入得到中文语境的润色指令，质量提升 |
| 结果缓存（按文本 hash） | 同一文本二次润色秒回，零 token |
| 错误分类结构化 | 用引擎错误码/超时标志而非文案子串，重试策略准确 |

### UI 变化

**有，且是 9 项中最大**：

1. 阻塞弹窗 → **流式就地预览**：输入框上方直接浮现润色中/润色结果 diff。
2. 新增**接受 / 重新生成 / 撤销**三个轻量操作，替代现在的整段替换。
3. 可进一步做"**发送前自动润色**"开关（治理报告建议项），开启后无感触发。
4. 超时/失败提示中文化、可重试。

---

## 8. curated-skills 重型基础设施只服务 2 个条目

**2026-07-26 复核**：🔶 **事件化完成，产品决策未做**（批次3 `85bc82b7e`，OpenSpec: curated-skills-settings-sync）。

已落地：
- **2s 轮询已消除**：后端在每次 toggle 成功后发 `curated-skills-changed` 事件，`CuratedSkillIndicator` 经 `subscribeCuratedSkillsChanged` 即时重取（`curatedSkillsEvents.ts`）。
- 兜底收敛为 **60s 可见性门控慢轮询**（`FALLBACK_REFRESH_MS`，仅防事件遗漏），符合"禁秒级轮询"红线。
- 内容未变时保留旧引用，避免常驻 composer 叶子被强制重渲染。

未落地：
- **"扩容 or 降级"产品决策仍悬置**——curated 注入链路的受益面仍只有 2 个 bundled skill（`caveman`、`lazy-senior-dev`），校验/注入链路的维护税问题原样存在。
- bundled curated skill 与 Skills Hub 用户安装技能的**展示边界**仍未收敛。

**2026-07-26 二次复核修正**：`skills-lock.json` 已扩至 12 条（新增 github 来源 vercel/writing 系列与 1 个 bundled `huashu-design`）——"锁文件只服务 2 个条目"的表述对锁文件本身不再精确，但 **curated 注入链路的受益面仍为 2 个**，核心结论不变。

**原状态（07-25）**：🔶 半修复。以下证据为 `c75922dec` 快照存档：

### 现状（证据）

- 全套 curated-skills 基础设施（锁文件、Rust `build.rs` 校验、注入管线）服务的 bundled skill 只有 **2 个**——"为两辆自行车修了座立交桥"。
- `src/features/curated-skills/components/CuratedSkillIndicator.tsx:32`：`POLL_INTERVAL_MS = 2000`，虽已套 `setVisibilityGatedInterval`（窗口隐藏时暂停），但**可见状态下仍每 2 秒轮询一次设置数据**——而设置是低频静态数据。
- 同时新 Skills Hub（`skills_hub.rs`，2995 行）走独立管线，两套技能面并行演化。

### 影响什么

- **过度工程的维护税**：校验/锁文件/注入链路每次升级都要维护，受益面只有 2 个条目。
- **空转轮询**：窗口可见期间每秒都在为几乎不变的数据发 IPC。
- **边界模糊**：bundled curated skill 与用户安装的 Skills Hub skill 没有清晰分工，两套指示器/入口让用户困惑"技能到底在哪管"。

### 处理后的影响

两条路线，**需先做产品决策**（治理报告原话："扩容 or 降级"）：

- **路线 A · 扩容**：curated bundle 扩充到有实际规模（比如内置高频官方技能集），基础设施利用率合理化；同时明确 bundled vs 用户安装的展示边界。
- **路线 B · 降级**：砍掉重型校验链，2 个条目退化为普通静态资源，注入走 Skills Hub 统一管线。
- 无论哪条：**用 settings 变更事件替代 2s 轮询**（仓库已有事件驱动先例，符合"禁秒级轮询"红线）。

### UI 变化

**基本无**。唯一可感知：状态栏技能指示器的刷新从"每 2 秒轮询"变为"设置变更即更新"，行为上更快、后台更安静。若走路线 B，技能管理入口收敛为一处，用户不再面对两个技能面板。

---

## 9. "对话→prompt/skill"一键沉淀缺失

**2026-07-26 复核**：🔶 **部分完成**（批次4 `7173c9c5f`，OpenSpec: conversation-prompt-distill）。

已落地（"存为 Prompt"全链路）：
- 新增 `src/features/prompt-distill/`：`usePromptDistillation`（297 行，复用 enhancer 已验证的隐藏 session 通道）、`PromptDistillDialog`（提炼预览，可编辑后保存）、`distillInstruction`（AI 提炼指令，自动插入 `$ARGUMENTS` 参数位）。
- 消息右键菜单新增"存为 Prompt"与"将整个线程存为 Prompt"两个入口（`useConversationNoteCaptureMenu.ts`）。
- 保存写入当前工作区命令目录，配合批次2 的 fs watch，保存后 `/` 补全**即时可见**。
- i18n 覆盖全部 10 种语言。

未落地：
- **"存为 Skill"**入口未做——当前产物仅为 slash command/prompt 模板，未沉淀为 Skills Hub skill。
- 与 #6 的协同（沉淀物带结构化参数、被参数面板调用）依赖 `args` 协议演进，同属后续项。

**原状态（07-25）**：❌ 未做。这是唯一一项**纯增量功能**（不是还债）。

### 现状

- 可行性已验证：prompt enhancer 的隐藏 session 通道（`usePromptEnhancer.ts:17-18`）证明"客户端可以悄悄起一个 AI session 干活，不打断当前对话"。
- 但目前没有任何入口把一段有价值的对话提炼成可复用的 prompt 模板或 skill——对话结束，经验即蒸发。

### 影响什么

- 你反复手敲的同类指令（"按仓库 commit 规范写提交信息"、"把这个组件拆成 hook + 视图"）无法沉淀，每次都重新组织语言。
- 团队场景下，个人摸索出的好 prompt 无法变成共享资产。

### 处理后的影响

- 新链路：选中对话片段 → 隐藏 session 让 AI 提炼成模板 → 自动插入 `$ARGUMENTS` 参数位 → 存为自定义 prompt / skill。
- 与第 6 项（技能契约结构化）天然协同：沉淀出的 skill 若带结构化参数，即直接可被参数面板调用。
- 成本可控：通道复用 enhancer 已验证的模式，主要工作是模板提炼 prompt 设计 + 存放 UI。

### UI 变化

**有，新增入口**：

1. 对话消息右键/悬停菜单新增"**存为 Prompt / 存为 Skill**"。
2. 弹出**提炼预览**：AI 生成的模板 + 高亮的 `$ARGUMENTS` 参数位，可编辑后保存。
3. 保存后立即出现在 `/` 命令补全与 Skills 面板中（依赖第 5 项的 fs watch 可做到即时可见）。

---

## 附：实施顺序建议（已全部执行，存档）

按"还债先于增量、无 UI 风险先于有 UI 变化"排序的四批已于 2026-07-25~26 全部落地：

| 批次 | 项 | 结果 |
|---|---|---|
| 第一批（纯清理，零风险） | #1 残留注释、#3 砍弃用输出 | ✅ `9484986c8` — #1、#3 关闭 |
| 第二批（行为一致性） | #2 历史单一实现、#5 命令 fs watch + 去兜底 | ✅ `32092503c` — #2、#5 关闭 |
| 第三批（体验升级） | #7 enhancer 流式化、#8 curated 决策 | 🔶 `85bc82b7e` — #7 修了本地化+缓存（流式/diff/错误码未做）；#8 事件化完成（产品决策悬置） |
| 第四批（增量能力） | #6 技能契约、#9 对话沉淀 | 🔶 `7173c9c5f` — #6 结构化契约下发（`args` 恒空）；#9 "存为 Prompt"上线（"存为 Skill"未做） |
| 加固（并发边界） | #5 watch 租约计数、#7 缓存 key 加 workspace 维度 | ✅ `296fad4a5` — 状态定性不变，并发健壮性提升 |

### 剩余尾项（后续立项候选）

1. **#7 增强**：enhancer 流式输出 + 就地 diff + 错误码结构化分类（9 项中剩余体验收益最大者）。
2. **#8 决策**：curated bundle 扩容 or 降级，bundled vs Skills Hub 展示边界收敛。
3. **#6 协议演进**：engine 侧解析 `skillInvocations.args`，解锁参数校验与参数表单 UI。
4. **#9 扩展**："存为 Skill"入口，依赖 #6 参数契约。

> ⚠️ 每项动手前请先在 OpenSpec 立项（治理报告风险节第 3 条：删除型/大颗粒提案按 capability 分片，避免烂尾）。
