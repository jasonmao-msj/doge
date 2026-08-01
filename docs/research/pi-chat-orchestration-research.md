# pi 生态编排调研：earendil-works/pi-chat + pi 会话控制 API

> **Lifecycle**：External Research Snapshot。不是 mossx orchestration contract。
> **最后复核**：2026-08-01；本地 pi 仓库锚定 `a9f5b1c123`（2026-07-24），当前 package scope 为 `@earendil-works/pi-coding-agent`。pi-chat upstream 未固定 commit 的结论须在复用前重新核验。
> 调研日期锚点：基于 GitHub main 分支当时源码与本地 pi 仓库文档。
> 来源一：https://github.com/earendil-works/pi-chat（README / AGENTS.md / index.ts / src/runtime.ts）
> 来源二：/Users/chenxiangning/code/AI/github/pi/packages/coding-agent/docs/{extensions.md, rpc.md, sdk.md}

## 一、pi-chat 是什么

pi-chat 是一个 **pi extension**（不是独立进程、不是 RPC client），把 Discord / Telegram 频道桥接到一个跑在 Gondolin micro-VM 沙箱里的 pi session。每个连接的频道 = 一个独立 pi 进程 + 一个独立 VM。

- README: https://github.com/earendil-works/pi-chat
- 架构（仓库 AGENTS.md，https://github.com/earendil-works/pi-chat/blob/main/AGENTS.md）：

```
Discord/Telegram ←→ Live Adapter ←→ Runtime (log, jobs, slices) ←→ pi agent
                                        ↕
                                   Gondolin VM (Alpine + bash)
                                   /workspace  /shared
```

注意：README 写 "Slack" 不适用——实际是 Discord + Telegram。另外 index.ts 里 import 的是 `@mariozechner/pi-coding-agent`，而本地 docs 用 `@earendil-works/pi-coding-agent`，是 rebrand 过渡期的包名差异，以本地 pi 仓库文档为准。

## 二、pi-chat 消息流与编排机制（全部基于源码）

### 2.1 入站：adapter → append-only log → trigger → job queue

- Live adapter（src/live/discord.ts、src/live/telegram.ts）收到消息后走 `runtime.ingestInbound()`，把 `inbound` record 追加到每频道一份的 JSONL 日志 `channel.jsonl`（src/runtime.ts:199-237）。
- **Trigger 判定**（src/runtime.ts:167-177）：DM 每条消息触发；频道默认 @mention 触发；access policy 过滤（allowedUserIds / allowedRoleIds / ignoreBots，src/runtime.ts:129-138）。`armAfterCurrentTail()` 在 catch-up 完成后"上膛"，重连补拉的历史消息只记录不触发（index.ts:751-753，AGENTS.md "On reconnect, catch-up messages are logged but do not trigger until a new trigger arrives after arming"）。
- 触发即写 `job_queued` record 并入 `pendingJobs` 内存队列（src/runtime.ts:222-236）。日志 record 类型：`checkpoint / inbound / job_queued / outbound / job_completed / job_failed / error`（AGENTS.md）。

### 2.2 出站：串行 dispatch → pi session → agent_end 回收

- **串行闸门** `tryDispatch`（index.ts:1075-1099）：`if (!runtime || chatTurnInFlight || !ctx.isIdle()) return;` —— 一个频道同一时刻只跑一个 job；取 `runtime.beginNextJob()`，然后 `pi.sendUserMessage(next.prompt)` 把聊天 transcript 作为一条 user message 注入 pi session。
- **Prompt slice 构造**（src/runtime.ts:248-257）：从最后一个 `job_completed` 边界之后到 trigger record 之间的所有 inbound 拼成 transcript，每行带 `[uid:ID]` 防伪标识。**失败的 job 不推进消费边界**（AGENTS.md："Failed jobs do not advance the consumption boundary"）→ at-least-once 语义。
- **回复回收** `pi.on("agent_end")`（index.ts:1396-1466）：从 `event.messages` 提取最终 assistant 文本；`stopReason === "aborted"/"error"/"length"` → `failActiveJob`；成功则经 liveConnection 发回聊天（120s 超时 race + abort race），写 `outbound` + `job_completed` record，然后再次 `tryDispatch` 排空队列。
- **Per-turn system prompt 注入** `pi.on("before_agent_start")`（index.ts:1371-1394）：仅当 `pendingChatDispatch` 标志为真（即本 turn 由聊天触发）才追加 chat 专用 prompt 后缀 + memory + skills。
- **工具白名单** `pi.on("tool_call")`（index.ts:1123-1133）：远程触发的 turn 里 block 掉 read/write/edit/bash/chat_* 之外的所有工具。

### 2.3 远程控制：control-before-ingest + abort-then-defer 模式

- `parseControlCommand`（src/runtime.ts:144-161）在 ingest 之前拦截聊天里的 `stop / compact / new / status`。
- 若 agent 正忙：**先 `ctx.abort()`，把后续动作存入 `pendingControlAction`，在 `agent_end`（aborted 分支）里再执行**（index.ts:704-747、1403-1413）。这是"对忙碌 session 做控制操作"的标准解法。
- `new` 的实现很有意思：不直接调 `ctx.newSession`，而是 `pi.sendUserMessage("/chat-new", { deliverAs: "followUp" })`（index.ts:736）——把 extension command 排队成 follow-up user message，由 `/chat-new` command handler 调 `ctx.newSession({ parentSession, setup })`（index.ts:1272-1284）。因为 session 控制 API 只在 command context 可用（见下），这是从 event/异步上下文安全触发 session replacement 的官方绕行方案（extensions.md:1297-1327 的 reload-runtime 例子同款模式）。
- **跨 session replacement 的状态携带**：`/chat-new` 的 `setup(sm)` 里 `sm.appendCustomEntry("pi-chat-state", { conversationId })`（index.ts:1279），新 session 的 `session_start` 里读回 → 连接关系在 session 切换后不丢失。tmux worker 启动时也是先 `SessionManager.continueRecent()` 建 session 文件、append 同样的 custom entry，再以 `pi --session <file> --chat-conversation <id>` 启动进程（index.ts:353-374）。

### 2.4 多会话编排：一频道一进程 + tmux + 文件系统状态总线

- pi-chat **没有**用 pi 的 RPC mode 做编排；多频道 = `/chat-spawn-all` 为每个频道 spawn 一个 detached tmux session，各跑一个交互式 pi 进程（index.ts:353-384，命令形如 `exec pi --session <file> --session-dir <dir> --chat-conversation <id>`）。
- **跨进程可观测性走文件系统**：每个 worker 每 15 秒把状态快照（model、contextPercent、queueLength、hasActiveJob、chatTurnInFlight 等）写到 `~/.pi/agent/chat/worker-status/<id>.json`（index.ts:824-858）；`chat_workers` tool 读这些快照，让一个**编排者 pi agent** 能通过工具监督全部 worker（README "The chat_workers tool exposes the same status to an orchestrating pi agent"）。这是 meta-orchestration：用 agent 管 agent，进程隔离 + 文件总线，无 RPC。

## 三、pi 会话控制 / 投递语义 API 全览（本地 docs）

### 3.1 Extension 层（docs/extensions.md）

**可用性约束**：session 控制方法只挂在 `ExtensionCommandContext` 上——"only available in commands because they can deadlock if called from event handlers"（extensions.md:1079-1081）。

| API | 语义 | 引用 |
|---|---|---|
| `ctx.waitForIdle()` | 等 agent 完全 settle（含自动重试、auto-compaction 重试、排队 continuation） | extensions.md:1096-1107 |
| `ctx.isIdle() / ctx.abort() / ctx.hasPendingMessages()` | 控制流辅助；isIdle 在 agent run / 重试 / compaction 重试 / queued continuation 期间为 false | extensions.md:1014-1016 |
| `ctx.newSession({parentSession, setup, withSession})` | 新建 session；setup 先改新 SessionManager，withSession 在切换后跑；`result.cancelled` 表示被 extension 取消 | extensions.md:1109-1140 |
| `ctx.fork(entryId, {position, withSession})` | 从指定 entry fork 出新 session 文件；`"before"`（默认）恢复 prompt 到编辑器；`"at"` 克隆整条 active path | extensions.md:1142-1166 |
| `ctx.navigateTree(targetId, {summarize, customInstructions, replaceInstructions, label})` | session tree 内原地跳转，不产生新 session 文件；可对被放弃分支生成 summary | extensions.md:1168-1185 |
| `ctx.switchSession(sessionPath, {withSession})` | 切换到另一个 session 文件；发现用静态 `SessionManager.list() / listAll()` | extensions.md:1187-1228 |
| `ctx.compact({customInstructions, onComplete, onError})` | 触发上下文压缩 | extensions.md:1051-1061 |
| `ctx.reload()` | 重载 extensions/skills/prompts；handler 内视为 terminal（`await ctx.reload(); return;`） | extensions.md:1273-1295 |

**Session replacement 生命周期与 footguns**（extensions.md:1230-1271）：
- `withSession` 收到的是 fresh `ReplacedSessionContext`（扩展 `ExtensionCommandContext`，带绑定到新 session 的 `sendMessage()` / `sendUserMessage()`）。
- 执行时点：旧 session 已发 `session_shutdown`、旧 runtime 已 teardown、新 session 已 rebound、新 extension 实例已收 `session_start`——但回调仍在**旧闭包**里跑。
- **捕获的旧 `pi` / 旧 `ctx` 已 stale，调用会 throw**；`ctx.sessionManager` 等提前取出的对象同样失效。只能捕获 plain data（string、id、序列化 config）。

**投递语义三模式**（extensions.md:1386-1435）：
- `pi.sendMessage({customType, content, display, details}, {triggerTurn, deliverAs})` —— custom message，参与 LLM context，但不伪装成用户：
  - `deliverAs: "steer"`（默认）：streaming 中排队，**当前 assistant turn 执行完 tool calls 之后、下一次 LLM 调用之前**投递（1404）
  - `deliverAs: "followUp"`：等 agent 彻底完成（无更多 tool calls）才投递（1405）
  - `deliverAs: "nextTurn"`：排到下一个 user prompt，不打断不触发任何东西（1406）
  - `triggerTurn: true`：idle 时立即触发 LLM 响应，仅对 steer/followUp 有效（1407）
- `pi.sendUserMessage(content, {deliverAs})` —— 真 user message，**总是触发 turn**；streaming 时必传 `deliverAs`（steer/followUp），否则 throw（1411、1429-1433）
- `input` 事件里可观测 `event.source: "interactive" | "rpc" | "extension"` 和 `event.streamingBehavior: "steer" | "followUp" | undefined`（extensions.md:898-901）→ 编排器注入的消息可以被下游 extension 识别来源。

### 3.2 RPC 层（docs/rpc.md）——同语义的外部进程协议

- `prompt` 命令：streaming 时必须带 `streamingBehavior: "steer" | "followUp"`，否则报错（rpc.md:56-65）；extension command 即使在 streaming 也立即执行（rpc.md:67）。
- 会话控制命令：`new_session`（可带 parentSession，rpc.md:137-157）、`switch_session`（rpc.md:597-612）、`fork`（rpc.md:615-637）、`get_fork_messages`、`get_state`、`get_session_stats`、`set_session_name`。均可被 `session_before_switch` / `session_before_fork` extension handler 取消（cancelled: true）。
- **supervision 友好**：`get_entries` 支持 `since` 参数作 durable cursor 增量拉取 session 条目（含 pre-compaction 历史与废弃分支），跨 client 重启有效（rpc.md:696-722）；`agent_end` 事件在"完整 session-level run settle（不再自动重试/compaction/queued follow-up）之后"发出（rpc.md:884）——这就是外部编排器的"该 session 已空闲"信号。

### 3.3 SDK 层（docs/sdk.md）——进程内嵌多 session

- `AgentSession`（sdk.md:71-111）：`prompt() / steer() / followUp() / subscribe() / abort() / compact() / navigateTree() / isStreaming / messages`。`prompt()` 在 streaming 时必须指定 `streamingBehavior` 否则 throw（sdk.md:212-220）。
- **关键分层**：session replacement API 不在 `AgentSession` 上，而在 `AgentSessionRuntime`：`newSession() / switchSession() / fork() / importFromJsonl()`（sdk.md:114-159）。replacement 后 `runtime.session` 变更，**事件订阅要重新 subscribe、用 extensions 要重新 `bindExtensions()`**（sdk.md:161-178）——与 extension 层 footguns 同一逻辑的 SDK 表达。

## 四、对 mossx 串线编排层（L3）最有参考价值的设计

1. **两种嵌入形态按需求选**：pi 官方给的路——Node 进程内用 `AgentSessionRuntime`（一个 runtime 管一个 active session，编排器持 N 个 runtime 即 N 个会话）；跨进程/跨语言用 `pi --mode rpc` 的 JSONL 协议（rpc.md:5 官方建议 Node 直接用 SDK）。pi-chat 演示了第三种：**进程即会话**（一频道一 pi 进程）+ tmux 管理 + 文件系统状态总线。对 mossx（Tauri/Rust 宿主）而言，RPC mode 是自然对应物；pi-chat 的"worker 每 15s 写状态快照文件"则是无长连接时的低成本 fallback。
2. **Job/slice 路由模型可直接搬**：append-only JSONL 事件日志（inbound/job_queued/outbound/job_completed）作为路由事实源；trigger → 排队 → dispatch 时按"上次完成边界"切 prompt slice；**失败不推进边界 = at-least-once**。mossx L3 的"消息路由到目标 agent 会话"可用同构设计：router log + 每目标 session 的消费游标。
3. **串行闸门 + agent_end 排空**：`chatTurnInFlight + isIdle()` 双重 guard，在 `agent_end`（RPC 语义 = 完全 settle，rpc.md:884）后递归 `tryDispatch`。对应 mossx：每个目标会话一个 in-flight 标志 + 队列，settle 事件驱动 drain，不要轮询。
4. **忙碌中控制操作的 abort-then-defer 模式**：想对运行中的 session 做 stop/compact/new，先 `abort()`，把动作挂起，在 settle 后执行（index.ts:1403-1413）。配合 `ctx.waitForIdle()`（extensions.md:1096）即完整工具箱。
5. **三档投递语义 = 编排器的消息优先级原语**：`steer`（插话纠偏，当前 turn 工具执行完即投递）/ `followUp`（顺序串联，等彻底结束）/ `nextTurn`（被动上下文铺垫，永不触发）。mossx 串线场景映射：跨会话接力用 followUp 语义；对运行中 agent 的实时干预用 steer；预置上下文用 `pi.sendMessage` + `nextTurn`（custom message 不伪装用户、可用 customType 标记编排来源，且 `input` 事件的 `source: "extension"` 让下游可区分）。
6. **从异步上下文触发 session replacement 的官方绕行**：session 控制 API 只在 command context 可用（防 deadlock）；从 event handler / 工具里要做 new/switch，就 `pi.sendUserMessage("/cmd", { deliverAs: "followUp" })` 排队一个 command（extensions.md:1297-1327；pi-chat index.ts:736 实际使用）。
7. **跨 replacement 的状态纪律**：只携带 plain data（pi-chat 用 `appendCustomEntry` 把 conversationId 写进新 session 文件）；旧 session 对象一律视为 stale；SDK 侧 replacement 后必须 re-subscribe + re-bindExtensions（sdk.md:161-178）。mossx L3 做会话切换时同样要把"路由绑定关系"持久化到 session 文件或外部 registry，而不是内存闭包。
8. **Per-dispatch prompt 注入与工具门控**：`before_agent_start` + one-shot 标志实现"仅对路由触发的 turn 追加路由上下文"（index.ts:1371-1394）；`tool_call` 事件按 turn 来源 block 工具（index.ts:1123-1133）。mossx 可据此实现"被串线驱动的会话使用受限工具集/专用 system prompt 段"。
9. **跨会话发现与监督**：`SessionManager.list()/listAll()` 静态发现（extensions.md:1205-1208）；RPC `get_entries?since=<entryId>` durable cursor 增量 tail（rpc.md:696-722）→ mossx 编排器可以不"拥有"会话也能监督其进展。
