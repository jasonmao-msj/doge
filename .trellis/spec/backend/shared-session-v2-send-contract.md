# Shared Session V2 Execution Target / Send Contract

## Scenario: Attempt-owned Provider-scoped Shared Turn

### 1. Scope / Trigger

- Trigger：修改 Shared Session 创建、四级 Target、V2 send、Binding provisioning、
  Runtime event ingress、terminal commit、Interrupt/Recovery、Projection attribution。
- 目标：`conversation.turnRequested.target` 是一次 Attempt 的唯一执行权威；CLI、
  Provider、Model、Reasoning 在 UI、IPC、Runtime side effect、历史重载中不得分裂。
- Foundation SSOT：
  `docs/research/mossx-multi-cli-provider-session-foundation-design.md`。
- Behavior SSOT：
  `openspec/changes/fix-shared-target-send-rollout/**`。

### 2. Signatures

Frontend orchestration：

```ts
startSharedSession(
  workspaceId,
  initialTarget: ResolvedExecutionTarget,
): Promise<SharedSession>

persistSharedSessionSelectedTarget(
  workspaceId,
  threadId,
  target: ResolvedExecutionTarget,
): Promise<void>

sendSharedSessionTurnV2({
  workspaceId,
  threadId,
  target, // 只供 Tx1 freeze；dispatch 不再接收 Target
  text,
  ...
}): Promise<SendSharedSessionTurnV2Result>

selectNextTarget(workspaceId, threadId, target): void
isComposerInputLocked(state): boolean
isComposerSubmitLocked(state): boolean
isPickerLocked(state): boolean
getSharedSendStateRevision(workspaceId, threadId): number
tryAcquireSharedSend(workspaceId, threadId):
  { acquired: true, state: "preparing-context", revision } | blocked
consumeSharedSendAdmission(workspaceId, threadId, revision): boolean
releaseSharedSendAdmission(workspaceId, threadId, revision): boolean
restoreSharedSendStateFromTurnState(
  workspaceId,
  threadId,
  turnState,
  expectedRevision?,
): boolean

reattachSharedSessionAttempt(
  workspaceId,
  threadId,
  activeRecoveryEnvelope,
): Promise<void>

subscribeSharedSessionAttemptSettlements(listener): () => void
```

Production Tauri commands：

```text
start_shared_session(workspaceId, selectedEngine?, initialTarget)

# read-only preview；不创建 Attempt/Binding，不写 Cursor，不触碰 Runtime
shared_session_v2_prepare_context(workspaceId, threadId, target)

# Tx1：唯一一次接收完整 Target
shared_session_v2_begin_turn(workspaceId, threadId, target, text)

# 以下 mutation 都只接收 durable identity
shared_session_v2_prepare_delivery(workspaceId, threadId, attemptId)
shared_session_v2_dispatch_turn(
  workspaceId, threadId, attemptId,
  artifactId, artifactChecksum,
  disableThinking?, accessMode?, images?, collaborationMode?,
  preferredLanguage?, customSpecRoot?
)
shared_session_v2_await_turn_terminal(workspaceId, threadId, attemptId)
shared_session_v2_commit_turn(workspaceId, threadId, attemptId)
shared_session_v2_mark_recovery(workspaceId, threadId, attemptId, reason?)
shared_session_v2_interrupt_turn(workspaceId, threadId, attemptId)

# bindingKey 只作 durable row identity；重建 target 从 row 派生
shared_session_v2_rebuild_binding(workspaceId, threadId, bindingKey)
shared_session_v2_probe_binding(workspaceId, threadId, bindingKey)
shared_session_v2_turn_state(workspaceId, threadId)
```

Rust internal boundaries：

```text
durable_attempt_owner(sessionId, attemptId)
accept_context_for_attempt_core(writer, sessionId, owner, ...)
accept_turn_for_attempt_core(writer, sessionId, attemptId, ...)

SharedRuntimeCoordinator.register_attempt(owner)
SharedRuntimeCoordinator.bind_runtime_turn(
  attemptId, runtimeTurnId?, nativeSessionId?
)
SharedRuntimeCoordinator.ingest_*_event(...)
SharedRuntimeCoordinator.drain_replay_barrier(attemptId)
SharedRuntimeCoordinator.wait_for_settlement(attemptId)
SharedRuntimeCoordinator.mark_cancel_intent(attemptId)
SharedRuntimeCoordinator.clear_cancel_intent(attemptId)

SharedEventWriter.binding_states_for_session(sessionId)
list_shared_sessions(workspaceId)
  -> SharedSessionSummary.nativeThreadIds
```

Domain / Storage：

```text
ResolvedExecutionTarget {
  engine,
  providerProfileId?,
  modelCatalogEntryId,
  model,                         # Runtime model
  reasoning?,
  providerProfileNameSnapshot,
  providerProfileSource          # selection: disk | managed
}

TurnExecutionSnapshot {
  engine,
  providerProfileId?,
  modelCatalogEntryId,
  model,                         # Runtime model
  reasoning?,
  providerProfileNameSnapshot,
  providerProfileSource          # canonical: local | managed
}

SharedSessionMeta.schemaVersion = 2
Binding Key = "{engine}:{providerProfileId || default}"
shared_binding_state.provisioning_json.state =
  prepared | creating | ready | recovery-required
```

### 3. Contracts

#### 3.1 Session creation and mutable selection

- 新 Shared Session MUST 提供完整 `initialTarget`。`selectedEngine` 仅可作为由
  `initialTarget.engine` 派生的 legacy mirror；缺 Target、partial Target 或 Engine
  不一致时，必须在创建任何目录/meta 前 fail closed。
- Shared UI MUST 只有四级 `ExecutionTarget` 选择入口。Engine-only `ConfigSelect`、
  `onSelectEngine` 或只写 `selectedEngine` 的 action 不得在 Shared surface 可达。
- Picker 只更新 `selectedNextTarget`。持久化必须先成功，再把同一 Target 发布到
  in-memory store；写盘失败时 UI 保留上一 Target 并显示错误，不能出现
  “界面已切换、重载又回退”的双状态。
- `selectedNextTarget` 只影响下一 Attempt。`activeTurnTarget`、Runtime owner 和历史
  Badge 只能读 immutable Snapshot。
- local/disk selection 在 freeze boundary 转成 canonical `local`；managed 保持
  `managed`。canonical boundary 收到 `disk` 或未知值必须拒绝。

#### 3.2 Preview, Tx1 and attempt ownership

- `shared_session_v2_prepare_context(target)` 是可丢弃的 read-only preview。它可以校验
  Target、读取现有 Binding/Cursor、编译预览 Manifest；不得创建 Attempt、写
  `context.deliveryPrepared`、推进 Cursor、物化 Binding 或调用 Runtime。
- `shared_session_v2_begin_turn(target, text)` 是 production lifecycle 唯一接收完整
  Target 的 mutation。它先校验完整 Provider provenance 与
  `modelCatalogEntryId + runtime model` pair，再 durable append
  `conversation.turnRequested`。
- Tx1 成功后，Engine、Provider、Model、Reasoning、Binding、Context、Control、
  terminal commit 全部从 `attemptId → conversation.turnRequested.target` 派生。
  frontend、legacy V0 flat fields、当前 Picker、global model state 均不能覆盖它。
- `modelCatalogEntryId` 用于 catalog/provenance；`model` 是 CLI/API Runtime identity。
  两者必须匹配同一 Provider-scoped catalog entry，Runtime adapter 只消费 `model`。

#### 3.3 Delivery and actual Runtime dispatch

- `prepare_delivery(attemptId)` 从 durable owner 编译 Context Package，并在外部 side
  effect 前原子写 artifact、`context.deliveryPrepared` 与 pending delivery。
- `dispatch_turn(attemptId, artifact identity, operational options)` 不接受第二套
  Engine/Provider/Model/Reasoning/Text。它先复核 artifact、package、pending phase 与
  durable owner，再按 `(workspace, engine, providerProfileId)` 物化/复用 Runtime。
- V2 dispatch MUST NOT 调用 V0 `send_shared_session_message`。Provider/Model rejection
  必须结算原 Attempt，不得回退 default Provider/Model。
- Context/Prompt acceptance 只能由 dispatcher 内部用真实 Adapter evidence 写入；
  frontend 不得调用独立 accept command 伪造 ACK。
- typed dispatch ACK 必须与 frozen owner 的 Engine、Provider、runtime Model、
  Reasoning、Binding 相等。字段缺失或冲突视为 ambiguous/contract violation，不能进入
  `running`。
- explicit rebuild 只接收 `bindingKey`，Engine/Provider 必须从对应 durable
  `shared_binding_state` row 派生；caller 不得借 rebuild 改写 Binding Target。

#### 3.4 Rust lifecycle owner and atomic replay

- Runtime event 必须先进入 `SharedRuntimeCoordinator`，再进入普通 UI fan-out。
  coordinator 按 `workspace + engine + exact runtimeTurnId` 认领；只有任一侧缺 Run
  identity 时才允许 `nativeSessionId` fallback。
- Runtime send 返回 exact identity 前到达的 event 进入 bounded unowned queue。
  `bind_runtime_turn` 必须在同一 coordinator lock 内注册 identity、开启 replay
  barrier、搬运已归属 ingress。
- barrier 存在期间，同 owner 的早到与新到 visible ingress 都按到达顺序排队。
  dispatcher 每批必须先发布 authoritative observation，再 emit 对应
  `AppServerEvent`；只有一次 drain 在 lock 内观察到空队列时才能原子清除 barrier。
  这防止 bind 与 emit 之间的新 event 越过 replay。
- Claude replay user-message 中的 exact context marker 是 transport ACK。它必须在
  barrier 内立即应用并唤醒 ACK waiter；不得因等待 visible drain 形成死锁。其余
  assistant/reasoning/tool/terminal 仍保持原顺序排队。
- Logical settlement 与 Runtime cleanup 必须分域。Claude CLI `type=result` 等 Provider
  typed final 在 owner 已解析为 exact Shared Attempt 时，必须立即归一为 terminal
  evidence；stdout/stderr drain、process reap、Stop hook/MCP child 退出与 post-turn
  usage 只能作为 cleanup/补充 usage，不能延迟 Shared `run.settled`。
- 同一 Attempt 后续迟到的 cleanup `TurnCompleted` 必须幂等吸收，不得生成第二个
  settlement、第二个 `conversation.turnCommitted` 或重复 Assistant Final。该提升只在
  Shared coordinator 内生效，Native Claude lifecycle 保持不变。
- assembler 在 ordinary fan-out/drop 前收集 assistant、Reasoning、Tool
  call/result、Artifact、private refs/omissions 与 structured outcome。terminal
  exactly-once 生成 immutable settlement；canonical commit 成功后才清 Runtime owner
  与 replay cache。
- accepted Shared Attempt 的 Runtime event forwarder 与 exact-Attempt settlement waiter
  MUST NOT 使用 full-Turn wall-clock deadline。Provider 已发出 typed completion 后的
  reasoning/stdout drain MAY 使用 bounded grace window；该局部 grace 不能从 Turn
  开始计时，也不能把仍 active 的 Runtime 解释为 terminal/recovery。
- 同一 Attempt MAY 同时存在原 observer 与 recovery reattachment。settlement 或 owner
  removal MUST 唤醒全部 waiters；只唤醒一个 observer 会让另一个永久悬挂。

#### 3.5 Control, recovery and projection

- Interrupt 只接收 `attemptId`，从 durable snapshot + coordinator owner 解析
  Engine、Provider、Binding、native Thread、runtime Turn。不得回退当前 Picker、
  active Engine 或 workspace-wide interrupt。
- 发 Runtime interrupt 前必须登记 attempt-owned cancel intent；同步/早到
  `TurnError` 结算为 `cancelled`。若 interrupt side effect 自身失败，必须清除 intent，
  后续真实 Runtime error 仍结算为 `failed`。
- ACK/terminal/commit 不确定时进入 `recovery-required`；同 Attempt 禁止盲重发。
  Restore 必须用 per-thread mutation revision 拒绝跨完整 send cycle 的 stale hydrate。
- 早期 idle read 只作 preflight。最后一个异步 preflight 后、任何 optimistic user
  message、activity timestamp 或 processing mutation 前，必须同步
  `tryAcquireSharedSend`；V2 orchestrator 只能消费一次 exact revision。失败 caller 的
  Runtime RPC 与上述 UI mutation 都为零。
- handoff 前同步失败只允许 `releaseSharedSendAdmission(exactRevision)`；已消费、旧
  revision 或别的 caller 禁止解锁。
- Recovery Probe 必须真实调用 durable owner API：Attempt 走
  `shared_session_v2_recover_attempt`，仅有 Binding 时先走
  `shared_session_v2_probe_binding`。零个/多个/unknown/error 均保持锁定，RPC error
  必须可见。
- accepted 且 coordinator-owned 的 recovery response MUST 返回 exact
  `attemptId`、`bindingKey`、`nativeThreadId`、`runtimeTurnId` 与 durable
  `executionTargetSnapshot`。Frontend 只有在以这些字段恢复 owner、Target 并挂上
  deduplicated terminal observer 后，才可展示 `running`；禁止从当前 Picker 重建。
- terminal observer transport failure 不是 Runtime failure。若 exact accepted owner
  仍存活，`mark_recovery` MUST 返回 `active` 且不得改写 Binding；frontend MUST 保留
  processing、Stop/Queue owner 与 frozen Target。晚到 durable terminal 通过同一
  reattachment path 安装 terminal barrier、清理 processing 并回到 `idle`。
- reattachment terminal cleanup MUST compare exact `attemptId` before clearing send owner、
  processing 或 active Target。旧 observer 的迟到 terminal 仍要安装其
  `runtimeTurnId` barrier，但不得清理已换代的新 Attempt。
- renderer restore 读到唯一 accepted/live owner 时，MUST 先进入
  `recovery-required` 关闭 send window，再调用 authoritative recovery + reattachment；
  在 observer 实际挂载前不得直接投影 `running`。owner absent/ambiguous 继续 fail
  closed。
- canonical projection 默认用于新 V2 Turn；legacy Shared snapshot 使用 dual-read，
  不读取或拼接 Native CLI session files。
- Shared dispatch terminal 收敛必须 Engine-neutral：任意 CLI 可以先返回 accepted start
  ACK，再由 backend exact-Attempt waiter 等待 Runtime settlement 并以 durable
  `conversation.turnCommitted` 收口。response/projected event 已携带 typed
  `run.settled` 时只作为 presentation/fast wakeup。缺少 inline/frontend terminal event
  本身不是 ambiguous delivery，禁止为 Claude、Codex 或未来 CLI 建立不同的 terminal
  completion contract。
- 带 `sharedOwner` 的 Shared V2 `turn/started` 只作为 Runtime projection evidence，
  不得进入 generic Native lifecycle 重新设置 `activeTurnId` / processing；后续
  assistant/reasoning/tool/error/terminal projection 仍按 Shared owner 路由。
- frontend 收到 Shared V2 durable committed response 后，MUST 在清理 processing /
  `activeTurnId` 前，用 response 的 exact `runtimeTurnId` flush pending realtime batch
  并写入 terminal ledger。之后同一 Runtime Turn 的 assistant/reasoning/normalized/raw
  item event 只能作为迟到 projection 丢弃，MUST NOT 重新设置 processing。
- Shared `turn/started` MAY 只更新 realtime ledger 的 active Runtime identity，以解除
  上一 Turn 的 thread-level settled fallback；该 identity-only path MUST NOT 进入
  generic Native lifecycle 或自行点亮 processing。缺失 exact `runtimeTurnId` 时必须
  输出 diagnostic，禁止用 `attemptId` / `logicalTurnId` 伪造 Runtime identity。
- Claude Shared coordinator 必须对等价 cumulative/full assistant、reasoning observation
  与 terminal fallback 做 canonical exactly-once merge；该兼容只位于 Shared
  accumulator，禁止改动 Native Claude event conversion 或 Codex accumulation。
- `destination-owned` 是目标 Native history 已持有事实的去重审计，不是 lossy omission。
  prepare status、确认 gate 与用户详情只计算 actionable omissions；零 portable delta
  必须生成空 `promptPrefix`，不得发送空 marker 或等待不存在的 checksum echo。
- Claude Native identity 在 coordinator boundary 必须归一为 `claude:<uuid>`；raw UUID
  只允许作为 Adapter ingress/CLI 参数。Runtime owner key 必须包含
  `workspace + engine + providerRuntimeKey + identity`，相同 UUID 不得跨 Provider 串线。
- 新 Codex Binding 在 `thread/start` 前必须登记 provider-scoped provisioning hold；
  exact thread id 已知后转为 native-session hold，最终只按 Shared owner fan-out。
- `list_shared_sessions` 必须把 V2 `shared_binding_state.native_session_id` 与 legacy
  `bindings_by_engine` 合并、去重后投影到 `nativeThreadIds`。Sidebar catalog exclusion
  必须使用该 durable projection，不能依赖首次 dispatch 的 frontend memory。
- Claude 明确返回 `No conversation found with session ID` 时，当前 Attempt 必须 exactly-once
  failed commit，Binding 标记 `recovery-required(native-session-not-found)`，UI 只进入
  typed Shared recovery；不得显示 raw Provider prose、自动重试或静默重建。
- 每轮 Badge 只读 `TurnExecutionSnapshot`。Reasoning-only/tool-only completed Turn
  必须投影空正文 provenance anchor，仍显示 CLI/Provider/Model；不得伪造 assistant
  content。
- 完整 `MOSSX_CONTEXT_PACKAGE` Shared Runtime prompt echo 是 transport/control item。
  presentation 只隐藏严格版本化、双 marker 匹配的重复 user echo；必须保留 canonical
  user input 及其后的 assistant/reasoning/tool 内容。禁止宽泛 `includes("MOSSX")`。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| 新建缺失/partial `initialTarget` | 创建前 `invalid-shared-target` | 写 Engine-only meta |
| `selectedEngine != initialTarget.engine` | fail closed | 静默选任一方 |
| Shared engine-only action | UI 不可达；backend 不得制造新的 partial target | 覆盖完整 Target |
| Picker persistence 失败 | 保留旧 store Target + 可读错误 | 先改内存后吞错 |
| read-only `prepare_context` | 零 canonical/Binding/Runtime side effect | 把 preview 当 Tx3 |
| managed Provider 缺失 | `target-unavailable`，Runtime 零副作用 | 改发 default |
| `modelCatalogEntryId/model` pair 不匹配 | Runtime 前 fail closed | 用 catalog id 调 CLI |
| durable Target A + poisoned flat Target B | Runtime/Binding/Context/Badge 全用 A | B 产生任何 side effect |
| artifact/package/pending owner 不匹配 | fail closed + recovery evidence | 发送后再补校验 |
| typed ACK Provider/Model/Reasoning 不匹配 | 不进入 running | 只校验 Engine/Binding |
| 同 Engine Provider A → B → A | 两个 Binding，第三轮复用 A | engine-only Binding |
| rebuild caller 伪造 Engine/Provider | 忽略 caller target；从 row 派生或拒绝 | 改写 durable Binding |
| event 在 Runtime identity bind 前到达 | 缓存，bind 后有序 replay | 丢 event |
| event 在 replay drain 期间到达 | 排在 barrier 后部，不能越过早到 event | live emit 抢跑 |
| Claude context echo 早到 | ACK waiter 可立即观察；visible event 仍有序 | barrier deadlock |
| accepted Turn 超过 30 分钟 | forwarder/waiter 继续 event-driven 观察 | elapsed time 伪造 recovery |
| 同 Attempt 有原 observer + reattach observer | terminal/removal 唤醒全部 waiter | `notify_one` 遗留幽灵 waiter |
| duplicate terminal | 只保留首次 settlement/commit | 第二条 final |
| exact `runtimeTurnId` + rebound native id | exact Run owner 结算 | 因 Thread id 变化丢 terminal |
| cancel intent 后同步 `TurnError` | commit `cancelled` | 显示普通 failure |
| interrupt side effect 失败 | 清 cancel intent，保留真实 failure 语义 | 永久把错误标取消 |
| Provider 已删除 | snapshot name + unavailable | 历史 Badge 消失 |
| legacy identity 不完整 | “历史配置未知” | 伪造“本地配置” |
| reasoning/tool-only Turn | provenance anchor + badge | 无 label 或伪造正文 |
| exact Shared prompt echo | 只隐藏 duplicate user transport item | 吞 assistant/reasoning |
| 用户正文讨论 `MOSSX` | 原样显示 | substring 误杀 |
| running/settling 编辑 draft | editable、保留 draft、submit blocked | 关闭 `contentEditable` |
| cancel-pending/recovery-required | Input/Submit/Picker 全锁 | 切 Target 绕过顺序 |
| 两个 caller 同时通过 idle preflight | exact 一个 admission；loser 零 optimistic/processing/RPC | read-check 当锁 |
| Recovery Binding 无 direct Attempt | 真实 probe binding；唯一 Attempt 再 recover | 只改 UI 文案假 Probe |
| Probe/Rebuild RPC 失败 | 保持 recovery-required + 可见错误 | 吞异常后伪装可恢复 |
| Probe 返回 accepted active owner | exact owner/Target + dedup observer 后 running | 只改 enum 或从 Picker 猜 Target |
| observer transport 失败但 owner active | 保留 owner/processing/Target，允许 reattach | 清状态并把 Runtime 当中断 |
| restart 发现唯一 live owner | recovery lock → authoritative reattach → running | 无 observer 直接 running |
| old observer 在新 Attempt 后返回 | 安装旧 Runtime barrier，不改新 owner/processing/Target | thread-level 无条件 cleanup |
| 同 Binding 只有 `destination-owned` facts | ready + zero-delta no-op | 弹迁移确认或发送空 marker |
| Claude raw UUID event + canonical Binding | 归一为 `claude:<uuid>` 并按 Provider scope 认领 | 新建 identity 或跨 Provider settle |
| Codex 首发 `thread/started` 早于 start ACK | provisioning hold；exact bind 后投影 Shared | 普通 Session row 闪现 |
| Sidebar refresh 只发现 V2 Binding | summary 从 `shared_binding_state` 输出 Native id 并排除 | 只读 V0 meta 后重新泄漏 |
| Claude Native session 明确不存在 | failed terminal + typed Binding recovery | raw `target-provider-rejected` 或自动重发 |

### 5. Good / Base / Bad Cases

- Good：`begin_turn(Target A)` 后只传 `attemptId`；Rust 从 Tx1 读取 A，Provider process
  key 与 CLI runtime model 都可观测为 A。
- Good：早到 terminal 与 drain 期间新 delta 均留在 barrier；authoritative
  observation 先于 UI event，terminal 只 commit 一次。
- Good：Turn 运行超过历史 30 分钟边界，event forwarder 与 settlement waiter 均继续
  等待；renderer observer 断开后 Probe 用 exact owner 重附，晚到 terminal 正常回
  `idle`。
- Base：`prepare_context(Target A)` 只返回预览，真正 Tx3 仍由
  `prepare_delivery(attemptId)` 从 Tx1 重新派生。
- Bad：V2 wrapper 在 Tx1 后调用 V0 command，并再次传
  `engine/model/effort/providerProfileId`。
- Bad：看到 `turn/start` response 或可见 final text 就由 frontend 构造 canonical
  `run.settled`。
- Bad：用 `timeout(30min, await_terminal)` 或从 Turn start 计算 forwarder deadline，
  timeout 后清空 active owner。
- Bad：`Probe(active)` 只把状态 enum 改为 `running`，没有恢复 exact terminal
  observer。
- Bad：先 `selectNextTarget(newTarget)`，持久化失败后仍让 UI 显示 newTarget。
- Bad：`rebuild_binding(bindingKey, engine, providerProfileId)` 信任 caller Target。

### 6. Tests Required

只跑增量验证：

```bash
pnpm vitest run \
  src/features/shared-session/services/sharedSessions.test.ts \
  src/features/shared-session/runtime/sendSharedSessionTurnV2.test.ts \
  src/features/shared-session/runtime/reattachSharedSessionAttempt.test.ts \
  src/features/shared-session/runtime/useSharedSendStateRestore.test.tsx \
  src/features/shared-session/runtime/sharedSessionBridge.test.ts \
  src/features/shared-session/runtime/sharedSendStateStore.test.ts \
  src/features/shared-session/components/SharedSendStatusBar.test.tsx \
  src/features/threads/hooks/useThreadMessaging.test.tsx \
  src/features/shared-session/target/targetStore.test.ts \
  src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx \
  src/features/composer/components/Composer.file-reference-token.test.tsx \
  src/features/composer/components/ChatInputBox/ChatInputBox.submit-button.test.tsx \
  src/features/shared-session/presentation/sharedProjection/dataSource.test.ts \
  src/features/messages/components/MessagesRows.stream-mitigation.test.tsx \
  src/features/messages/components/Messages.user-input.test.tsx \
  src/features/threads/loaders/sharedHistoryLoader.test.ts

pnpm exec tsc --noEmit --pretty false
pnpm run check:runtime-contracts

cargo test --manifest-path src-tauri/Cargo.toml --lib shared_runtime_coordinator
cargo test --manifest-path src-tauri/Cargo.toml --lib settlement_wait_
cargo test --manifest-path src-tauri/Cargo.toml --lib execution_target_contract_tests
cargo test --manifest-path src-tauri/Cargo.toml --test shared_session_v2
cargo test --manifest-path src-tauri/Cargo.toml --test shared_session_v2_target_matrix
cargo test --manifest-path src-tauri/Cargo.toml --test shared_projection
cargo check --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --lib --bin cc_gui_daemon
```

关键断言：

- 新建 Session 的 meta 一开始就含完整 Target；不存在 Engine-only 新 Session。
- persist-first：selection IPC 失败时 in-memory Target 与 durable Target 都不变。
- `prepare_context` 零写入；`begin_turn → prepare_delivery → dispatch_turn` 只有 Tx1
  接收 Target。
- poisoned flat fields 无法影响实际 Provider process key、Binding 或 CLI model。
- `modelCatalogEntryId != model` 时两者均落盘，Runtime 只收到 `model`。
- pre-bind event、drain 期间 event、duplicate terminal 的顺序与 exactly-once。
- exact Attempt waiter 在任意短 observation window 后仍 pending；settlement/removal
  唤醒全部并发 waiter；desktop/daemon provider forwarder 源码不含 full-Turn deadline。
- 两个并发 caller 只有一个 optimistic/processing/send；admission revision 只能消费一次。
- Recovery Attempt/Binding Probe 均真实调用 owner API；unknown/error 不解锁。
- Probe(active) 先恢复 exact owner/Target 并 dedup reattach；observer detach 与 restart
  不清 processing，晚到 durable terminal 安装 barrier 后统一回 idle。
- stale reattachment terminal 只安装旧 Runtime barrier；exact attempt guard 保留新
  owner、processing 与 active Target。
- context echo 不被 barrier 阻塞，assistant/reasoning/tool 不被 prompt filter 吞掉。
- cancel intent/clear intent 分别产生 cancelled/failed。
- destination-owned-only package 为 `ready`、`promptPrefix=""`、`0 → 0`，Runtime 只收到
  当前用户请求。
- Claude raw/prefixed identity、Provider A/B 隔离、早到/正常 terminal 都 exactly-once
  settle；missing Native session 只产生 typed Binding recovery。
- Codex 首发 provisioning event 不进入 Native fan-out；V2 Binding identity 经
  `list_shared_sessions` 后仍从 Sidebar catalog 排除。
- canonical reload 保留 rich blocks、outcome、per-turn provenance；legacy dual-read 不丢
  历史且不导入 Native session history。

### 7. Wrong vs Correct

#### Wrong

```ts
await sharedSessionV2BeginTurn(workspaceId, threadId, target, text);
await sendSharedSessionMessage(
  workspaceId,
  threadId,
  engine,
  text,
  { providerProfileId, model, effort },
);
```

#### Correct

```ts
const begun = await sharedSessionV2BeginTurn(
  workspaceId,
  threadId,
  freezeTurnSnapshot(target),
  text,
);
const prepared = await sharedSessionV2PrepareDelivery(
  workspaceId,
  threadId,
  begun.attemptId,
);
await sharedSessionV2DispatchTurn(workspaceId, threadId, {
  attemptId: begun.attemptId,
  artifactId: prepared.artifactId,
  artifactChecksum: prepared.artifactChecksum,
});
```

#### Wrong

```ts
await withTimeout(
  sharedSessionV2AwaitTurnTerminal(workspaceId, threadId, attemptId),
  THIRTY_MINUTES,
);
setSharedSendState(workspaceId, threadId, "recovery-required");
clearActiveAttempt(workspaceId, threadId);
```

#### Correct

```ts
await reattachSharedSessionAttempt(
  workspaceId,
  threadId,
  activeRecoveryEnvelope,
);
// exact Runtime settlement / owner removal 决定结束；elapsed time 不是 terminal。
```

#### Wrong

```ts
selectNextTarget(workspaceId, threadId, target);
await persistSharedSessionSelectedTarget(workspaceId, threadId, target);
```

#### Correct

```ts
await persistSharedSessionSelectedTarget(workspaceId, threadId, target);
selectNextTarget(workspaceId, threadId, target);
```

#### Wrong

```rust
emit_ui_event(event);
coordinator.ingest(event);
```

#### Correct

```rust
let observation = coordinator.ingest(event);
publish_shared_runtime_observation(&observation);
emit_projected_ui_event(event);
```

#### Wrong

```rust
let native_thread_ids = meta.bindings_by_engine.values();
// V2 binding 只在 shared_binding_state，刷新后会泄漏普通 Session。
```

#### Correct

```rust
let native_thread_ids = legacy_native_ids
    .chain(writer.binding_states_for_session(session_id)?.native_session_ids())
    .dedup();
```

## Scenario: Shared Queue / Fusion / Compaction Continuity

### 1. Scope / Trigger

- Trigger：修改 Shared follow-up queue、Fusion、V2 typed result、Codex
  auto/manual compaction、Shared manual compact route 或 Composer compaction
  projection。
- 目标：User Run、Compaction、Retry 与 Follow-up 在 exact
  `Attempt → TurnExecutionSnapshot → Binding → Native Session` owner 上严格串行；
  queue item 只有在 successor canonical commit 后才可删除。
- Behavior SSOT：
  `openspec/changes/restore-shared-queue-fusion-compaction-continuity/**`。

### 2. Signatures

Frontend queue / dispatch：

```ts
type SharedQueuedExecutionTarget = {
  engine: EngineType;
  providerProfileId: string | null;
  modelCatalogEntryId: string;
  model: string;
  reasoning: { effort: string } | null;
  providerProfileNameSnapshot: string;
  providerProfileSource: "disk" | "managed";
};

type QueuedMessage = {
  id: string;
  text: string;
  createdAt: number;
  images?: string[];
  sendOptions?: MessageSendOptions;
  sharedExecutionTarget?: SharedQueuedExecutionTarget;
  sharedPredecessorAttemptId?: string | null;
  sharedDispatchState?: "pending-ack";
};

type ThreadMessageDispatchResult =
  | SendSharedSessionTurnV2Result
  | { status: "ambiguous-error"; reason: string }
  | undefined;

readSharedQueuedFollowUps(workspaceId, threadId): QueuedMessage[]
writeSharedQueuedFollowUps(workspaceId, threadId, queue): void
```

Backend control lane：

```text
WorkspaceSession.reserve_codex_user_dispatch(nativeThreadId)
WorkspaceSession.release_codex_user_dispatch_reservation(nativeThreadId)
WorkspaceSession.try_reserve_codex_manual_compaction(nativeThreadId)
WorkspaceSession.release_codex_compaction_reservation(nativeThreadId)

AutoCompactionThreadState {
  isProcessing,
  inFlight,
  pendingUserDispatch,
  pendingUserDispatchAtMs,
  pendingHighWatermarkPercent,
  lastTriggeredAtMs
}

resolve_shared_compaction_route(workspaceId, sharedThreadId)
  -> { engine, providerProfileId, nativeThreadId, hasUnresolvedAttempt }
```

### 3. Contracts

#### 3.1 Frozen Shared follow-up envelope

- Shared `running` / `settling` MAY accept an explicit follow-up into the local
  durable queue；`preparing-context`、`degraded-context`、
  `awaiting-acceptance` MUST block submission，`cancel-pending` /
  `recovery-required` MUST lock input、submit 与 Target picker。
- Enqueue MUST freeze `text`、`images`、serializable `sendOptions`、complete
  `SharedQueuedExecutionTarget` 与 exact predecessor Attempt。运行态缺
  predecessor identity MUST fail closed。
- Shared queue MUST use immediate client-store writes。Restore MUST validate the
  full Target and discard an invalid envelope；it MUST NOT recover Target from
  current Picker or an embedded `sendOptions.sharedExecutionTarget`。
- Actual successor dispatch MUST pass the frozen Target into Shared V2 Tx1；
  current Picker、active Engine 或 global model state MUST NOT override it。

#### 3.2 Typed drain and exactly-once removal

- Shared queue drain MUST wait for Shared send state `idle`，which represents
  predecessor settlement plus canonical commit，and MUST additionally wait until
  `isContextCompacting=false`。
- Drain MUST mark the item `pending-ack` before handoff and guard duplicate React
  effect execution。Only a matching result with `status="accepted"`、
  `v2.committed=true`、non-empty Attempt/logical Turn identities and exact
  Engine/Provider/Model/Reasoning MAY remove the item。
- `blocked`、`target-unavailable`、`recovery-required` or an exact-target mismatch
  MUST retain the original item and order。An untyped exception or missing ACK is
  ambiguous：the item MUST remain `pending-ack` and MUST NOT be blindly replayed
  after restart。
- A blocked item MAY retry only after a newer Shared send-state revision；a stable
  blocked state MUST NOT create a render/effect busy loop。

#### 3.3 Fusion capability cutover

- Only runtime-probed `input.mid-turn=supported` MAY use same-run steer。
  `compat-input` MUST NOT resolve to `route=steer`。
- `compat-input` Fusion MUST interrupt the exact predecessor Attempt，wait for
  Shared canonical `idle`，dispatch the frozen item as a successor，then require
  successor start/continuation or stronger canonical commit evidence。
- `unsupported` MUST remain an ordinary follow-up。It MUST NOT call steer、
  interrupt cutover or a different engine's compaction path。
- Target、Provider、Model、Reasoning、predecessor Attempt or Binding generation
  mismatch MUST disable Fusion；linear queue semantics remain available。

#### 3.4 Codex compaction / send barrier

- `turn/start` MUST reserve `pendingUserDispatch` before the first Runtime side
  effect。If compaction already owns the native-thread gate，the untouched prompt
  waits for `thread/compacted` / `thread/compactionFailed` and is then sent for the
  first time。
- Usage at or above the high-watermark while a Turn is processing MUST latch
  `pendingHighWatermarkPercent`。A terminal event MUST evaluate that latch even
  when the terminal itself carries no usage。
- A stale predecessor terminal MUST NOT clear a newer `pendingUserDispatch`。
  Missing compaction completion or prompt-start evidence MUST release its stale
  reservation after the 120s bounded timeout and emit a diagnostic；同一时刻只允许
  一个 pending prompt reservation。
- `turn/completed` outcome normalization MUST inspect supported nested aliases,
  including `params.turn.status` and `params.result.status`；`replaced` MUST remain
  distinct from `completed` and MUST NOT trigger blind replay。

#### 3.5 Shared manual compact and lifecycle projection

- Shared manual compact MUST resolve unresolved Attempt owner first；otherwise it
  reads `shared_sessions_v2.selected_target_json` as the durable selected Target。
  It MUST validate exact Binding key、generation、availability、provisioning state
  and native session identity。
- Active/unresolved Shared Attempt MUST reject manual compact。Codex MUST use the
  native-thread barrier；Claude MUST preserve the exact provider-scoped `/compact`
  path；other engines MUST return actionable `unsupported` without Runtime calls。
- Shared Composer MUST project existing low-frequency active-thread compaction
  lifecycle scalars。It MUST NOT reintroduce per-delta AppShell root state updates。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| running / settling submit | 冻结完整 envelope 并入队一次 | 立即创建第二个 Runtime Turn |
| pre-acceptance submit | 保留 draft，零 queue/Runtime side effect | 绕过 admission 入队 |
| persisted Target invalid | 丢弃无效 item | 用当前 Picker 补 Target |
| predecessor 未 commit | queue 保持原位 | 仅凭 child `turn/completed` drain |
| compaction active | queue 等待 lifecycle release | 压缩中投递 successor |
| matching canonical ACK | exactly-once 删除 item | React effect 重复 dispatch |
| blocked / target unavailable | 保留 payload/order，等新 revision | 先删后报错 |
| ACK 缺失或 Target mismatch | 保持 `pending-ack`，要求恢复/人工处理 | 自动盲重发 |
| `input.mid-turn=supported` | MAY same-run steer，等待 continuation | 未见证据即宣告 Fusion 成功 |
| `compat-input` | interrupt → settle → successor | 伪装 same-run steer |
| `unsupported` | 普通 follow-up | 调 steer/interrupt/compact |
| processing 期间达到阈值 | latch，settlement 后评估 | 丢失 high-watermark |
| compaction-first | prompt 等待，release 后首次发送 | control Turn 替换 prompt |
| prompt-first | compaction 保持 pending | 与 `turn/start` 并发 |
| prompt reservation 无 start evidence | 120s bounded release | 永久占用 barrier |
| nested `turn.status=replaced` | canonical outcome=`Replaced` | 按 method 猜 `Completed` |
| Shared manual compact 有 active Attempt | actionable busy error | 启动第二条 control lane |
| unsupported Shared Target compact | capability error，Runtime 零调用 | 按 logical id 猜 Codex |

### 5. Good / Base / Bad Cases

- Good：Shared `running` 时冻结 Target A 与 predecessor Attempt；即使之后 Picker
  变为 B，successor 仍用 A，经 V2 canonical commit 后删除一次。
- Good：Codex compaction 已占 gate；新 prompt 保持未发送，compaction lifecycle
  release 后首次发出。
- Base：`compat-input` 点击 Fusion 后先 interrupt；predecessor durable idle 后创建
  successor，canonical commit 直接作为更强 continuation evidence。
- Bad：queue drain 在调用 `sendUserMessageToThread` 前先 `shift()`。
- Bad：把 `compat-input` 当 native steer，或按 `shared:*` prefix 选择 Codex compact。

### 6. Tests Required

只跑本场景的 focused validation：

```bash
npm exec vitest -- run \
  src/features/threads/hooks/useThreadMessaging.test.tsx \
  src/features/threads/hooks/useQueuedSend.test.tsx \
  src/app-shell-parts/useAppShellSearchAndComposerSection.test.tsx \
  src/features/app/hooks/useComposerController.test.tsx \
  src/features/threads/utils/sharedQueuedFollowUpStore.test.ts \
  src/features/shared-session/target/sendStateMachine.test.ts \
  src/features/threads/contracts/engineMessageDelivery.test.ts \
  src/features/layout/hooks/useLayoutNodes.client-ui-visibility.test.tsx \
  src/features/shared-session/runtime/sendSharedSessionTurnV2.test.ts

npm run typecheck
npm run check:runtime-contracts

cargo test --manifest-path src-tauri/Cargo.toml --lib compaction
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  stale_user_dispatch_reservation_is_bounded_and_exclusive
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  codex_nested_replaced_completion_preserves_replaced_outcome
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --bin cc_gui_daemon
```

关键断言：

- queue restart restore 保留 full payload、frozen Target、predecessor identity；
  invalid envelope fail closed。
- blocked item 不删除、不 busy-loop；ambiguous ACK 保持 `pending-ack` 且不 replay；
  matching canonical ACK exactly-once 删除。
- Shared `running` / `settling` 可入队；pre-acceptance 与 ambiguous states 仍锁定。
- `supported` same-run continuation、`compat-input` explicit cutover 与
  `unsupported` follow-up degradation 分支互斥。
- compaction-first、prompt-first、processing high-watermark latch、stale terminal 与
  bounded timeout 均由 focused Rust tests 覆盖。
- Shared manual compact 使用 unresolved owner 或 selected Target 的 exact Binding；
  unsupported engine 与 active Attempt 均 fail closed。
- Shared Composer 只消费 existing lifecycle scalar；runtime-contract gate 继续通过。

### 7. Wrong vs Correct

#### Wrong

```ts
const item = queue.shift();
await sendUserMessageToThread(workspace, threadId, item.text);
```

#### Correct

```ts
const result = await sendUserMessageToThread(
  workspace,
  threadId,
  item.text,
  item.images,
  { ...item.sendOptions, sharedExecutionTarget: item.sharedExecutionTarget },
);
if (isMatchingCanonicalCommit(result, item.sharedExecutionTarget)) {
  removeQueuedItemExactlyOnce(item.id);
}
```

#### Wrong

```rust
if shared_thread_id.starts_with("shared:") {
    compact_codex(shared_thread_id).await?;
}
```

#### Correct

```rust
let route = resolve_shared_compaction_route(state, workspace_id, shared_thread_id)?;
match route.engine {
    EngineType::Codex => compact_codex(route.native_thread_id).await?,
    EngineType::Claude => compact_claude(route.native_thread_id, route.provider_profile_id).await?,
    engine => return Err(compaction_unsupported(engine)),
}
```

## Scenario: Shared Provider-aware Target Picker

### 1. Scope / Trigger

- Trigger：修改 Shared Composer 模型菜单、Provider Profile catalog、
  `selectedNextTarget` 或 target display。

### 2. Signatures

```ts
getEngineModels(engine, { providerProfileId }): Promise<EngineModelInfo[]>
onExecutionTargetChange({
  engine,
  providerProfileId,
  modelCatalogEntryId,
  model,
  reasoning,
  providerProfileNameSnapshot,
  providerProfileSource,
}): void
```

### 3. Contracts

- Picker hierarchy MUST be `CLI → Provider Profile → Model`，Reasoning 作为同一
  Target 的相邻级；选择 Model MUST 形成完整 `ResolvedExecutionTarget`。
- catalog request/cache key MUST include `engine + providerProfileId`。
- `__local_settings_json__`、`__disk__`、`__local_config_toml__` 只用于 catalog
  lookup；写入 Target 前 MUST normalize 为 `providerProfileId = null`。
- catalog item 的 `id` 与 `model` 必须分别写入 `modelCatalogEntryId` 与 runtime
  `model`；不能用一个字段兼任两种 identity。
- Shared surface MUST NOT 同时展示或响应 Engine-only `ConfigSelect`。所有 CLI 切换都
  必须经过同一四级 Target callback。
- target change 必须串行执行 `persist → publish store`；持久化失败时保留旧 selection。
- 当前按钮 MUST 从完整 Target catalog 解析 Model label，不得回读旧 Engine catalog。
- 未验证 target acceptance 的 CLI MUST visible-disabled with reason；MUST NOT fallback。
- root menu open MUST NOT fetch every model catalog；model fetch 只能由用户展开 CLI 触发。

### 4. Validation & Error Matrix

| 场景 | 结果 | 禁止行为 |
|---|---|---|
| Provider A/B 有同名 Model | 按完整 Target 选择正确 Binding | 按 Model ID 猜 Provider |
| local sentinel | Target 写 `null` | 创建 `engine:__local_*__` 重复 Binding |
| catalog `id != model` | 同时保存两者 | 把 `id` 发给 Runtime |
| Shared 点击另一 CLI | 打开/选择完整四级 Target | 调用 Engine-only handler |
| selection persistence 失败 | 仍显示旧 Target并提示错误 | memory/disk 漂移 |
| 一个 profile catalog 失败 | 只显示该 profile error | 清空其他 CLI/Profile |
| Kimi target 未验证 | 显示 disabled reason | 隐藏或改发其他 CLI |

### 5. Good / Base / Bad Cases

- Good：展开 Codex CLI 后只加载 Codex 各 Provider catalog，点击模型一次写完整 Target。
- Base：本地 Claude catalog 使用 sentinel 查询，Target 保存 canonical `null`。
- Good：持久化完成后才更新按钮 label；失败时按钮仍显示上一次 durable Target。
- Bad：切到 Codex 后按钮继续从 Claude models 找 label，显示成“选择模型”。
- Bad：Shared 同时保留 `ConfigSelect.onSelectEngine`，让 Engine 与四级 Target 各自成为
  selection authority。

### 6. Tests Required

- `ModelSelect.test.tsx`：跨 Provider 点击、同名 Model、`id != model`、local sentinel、
  Target label、Shared 不走 Engine-only callback。
- `useSharedProviderTargetCatalog.test.tsx`：lazy/cache、partial failure、binding error。
- `Composer.file-reference-token.test.tsx`：明确的 `null` 不得回退旧
  Provider/reasoning；persistence rejection 不得更新 store。
- `sharedSessions.test.ts`：new Session 缺 partial target fail closed。

### 7. Wrong vs Correct

#### Wrong

```ts
onSelectModel(modelId);
```

#### Correct

```ts
const target = {
  engine,
  providerProfileId: isLocalProfile ? null : providerProfileId,
  modelCatalogEntryId: catalogEntry.id,
  model: catalogEntry.model,
  reasoning: sameBinding ? current.reasoning : null,
  providerProfileNameSnapshot,
  providerProfileSource,
};
await persistSharedSessionSelectedTarget(workspaceId, threadId, target);
selectNextTarget(workspaceId, threadId, target);
```

## Scenario: Shared Context Package Delivery

### 1. Scope / Trigger

- Trigger：修改 `shared_context` compiler、Context Package、Artifact Store、Context
  ACK、Binding cursor 或 degraded-context UI。
- 目标：跨 Provider 切换时只从 Shared Canonical Log 派生上下文；未获得 Adapter
  证据时 fail closed，禁止重复注入或提前推进 cursor。
- Behavior SSOT：`openspec/changes/add-shared-context-compiler/**`。

### 2. Signatures

```text
shared_session_v2_prepare_delivery(workspaceId, threadId, attemptId)
shared_session_v2_dispatch_turn(
  workspaceId, threadId, attemptId, artifactId, artifactChecksum, ...
)
shared_session_v2_await_turn_terminal(workspaceId, threadId, attemptId)
accept_context_for_attempt_core(
  writer, sessionId, durableAttemptOwner,
  packageId, nativeSessionId, nativeRequestId?
)
shared_context_retrieve_artifact(workspaceId, threadId, artifactId, checksum)
shared_context_scan_orphans()

ContextPackage {
  schemaVersion, packageId, sessionId, bindingKey, destination,
  stablePrefix, delta, promptPrefix, manifest, compression
}

Binding context cursor {
  acceptedThroughSequence,
  committedThroughSequence,
  pendingDelivery
}
```

### 3. Contracts

- Compiler source 只能是 Shared Canonical Log；当前 `turnRequested` 的 sequence 是
  exclusive upper boundary，禁止把本轮 user prompt 重复编进 Context Package。
- `prepare_delivery` 与 Adapter delivery 必须从同一 `attemptId` 加载 durable Target、
  logical Turn 与 Binding；frontend 不得重复传 `target/logicalTurnId/bindingKey` 作为
  mutation authority。
- mode 固定按 capability 选择：
  `native-delta > native-history-import > native-history-clone >
  portable-transcript > checkpoint`。缺 destination identity 时不得选
  `native-delta`。
- `context.deliveryPrepared` 与 pending 必须先于外部 context side effect 落盘。
  Adapter ACK 只推进 accepted；terminal canonical commit 才推进 committed 并清
  pending。
- Codex `thread/inject_items` 只有 JSON-RPC success 才算 strong ACK。Claude
  transcript/checkpoint 只有匹配 package/checksum 的 replay echo 才算 strong ACK。
  weak fidelity 必须显式返回，禁止宣称 exactly-once。
- tool call/result 成对保留或成对省略；private reasoning、failed/aborted assistant、
  unsupported image 和 historical control 必须写 Manifest disposition。
- package id MUST 覆盖 compiler version、destination identity、capabilities、effective
  budget、source range 与 Binding；上述任一输入变化 MUST 产生不同 identity。
- Artifact 按 workspace/session 隔离；checksum MUST 覆盖序列化后的
  `ContextPackage` payload，读取时必须重算。损坏的现有 artifact MUST 隔离并原子重写，
  读取结果永远 `referenceOnly=true`。orphan scan 只报告，不自动删除。
- Artifact publish MUST 使用同目录 create-new temp + file sync + atomic rename；Unix
  额外 sync parent directory，Windows 使用 rename durability boundary，失败路径清理 temp。
- UI 只在 prepare/confirm/ACK/terminal 等阶段边界更新；禁止 per-entry setState
  和新增 polling。
- Shared Send 的 control completion MUST 调用 backend exact-Attempt await command，并以
  durable `conversation.turnCommitted` 为最终成功判据。projected UI event、Agent Event
  Bus 与 inline terminal 只能用于 rendering、notification 或 fast path，不得单独把
  Composer 置为 idle，也不得因 listener 漏事件把已 commit Attempt 标为 recovery。
- exact-Attempt await 与 upstream Runtime event forwarder MUST 使用 event-driven
  settlement，不得对完整 Turn 施加 wall-clock timeout。只允许 completion 后 cleanup
  grace、首包/ACK、health probe 等 phase-local bounded timeout。
- durable commit 写入 frontend terminal ledger 的生命周期 MUST 跨普通 React rerender
  保持稳定；清空 ledger / pending queue / timer 的 cleanup 只能发生在 hook unmount。
  cleanup effect 不得因 flush callback identity 更新而执行。
- await command MUST 在等待前、收到 settlement signal 后、以及 coordinator owner 被
  critical sink 清理后复查 durable fact；terminal commit/remove race 必须幂等收敛。
  command shape 只接收 Workspace/Shared Thread/Attempt，不接收 Target 或 Runtime owner。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| compile 失败 | 无 pending、无 cursor 推进、无 runtime side effect | 先发 prompt 再补事实 |
| caller 尝试重复声明 Target/Binding | command shape 不接收；内部只读 durable owner | 比较后仍允许 caller 覆盖 |
| 当前 turn 已写 Tx1 | package upper bound 为该 sequence 前一条 | 把当前 user prompt 重复放入 prefix |
| Codex import timeout/disconnect | 保留 pending，进入 recovery | fallback prompt-prefix 后重复发送 |
| Claude checksum echo 缺失/不匹配 | `ackAmbiguous` + recovery-required | 推进 accepted |
| context 已 accepted、run failed | accepted 不回退；terminal 后 committed 前进 | 重放同一 package |
| 另一 Target 发现 unresolved pending | 返回 recovery-required | 绕过 pending 开新线性操作 |
| cross-workspace/session artifact | ownership error | 返回内容 |
| package destination/capability/budget 改变 | 新 package id | 复用旧 artifact |
| artifact payload 被篡改 | integrity error；prepared 且无外部副作用时隔离重写 | 返回篡改内容 |
| valid degraded package | 记录 omissions 后自动 best-effort 发送 | 阻塞等待继续/取消确认 |
| frontend terminal event 丢失、SQL 已 commit | durable await 返回 committed 并释放 Composer | 永久 running / 误进 recovery |
| event sink commit 后先清 coordinator owner | await 复查 SQL 并幂等成功 | 报 attempt missing |

### 5. Good / Base / Bad Cases

- Good：Tx1 写当前 user intent；compiler 只读上一条 sequence；Tx3 写 pending；
  Adapter ACK 推进 accepted；terminal commit 推进 committed。
- Good：frontend 即使完全没收到 terminal event，backend waiter 仍被 settlement signal
  唤醒并从 SQL 确认 commit，Shared Composer 正常回 idle。
- Good：Claude typed `result` 到达即结算 Shared Attempt；进程和 stdio 随后独立清理，
  迟到 `TurnCompleted` 只作为 duplicate cleanup 被忽略。
- Base：目标只支持 transcript，UI 显示 omissions/compression，用户确认后携带
  marker 发送。
- Bad：把 `turnCommitted.sequence` 当 context cursor；这是 runtime terminal 的
  sequence，不是 package 的 `throughSequenceInclusive`。
- Bad：把 Claude process spawn/stdin write 当 terminal 或 context ACK。
- Bad：已经收到 Claude typed `result`，仍等待 process exit/stdout EOF/stderr drain
  才允许 Shared Composer 结束。

### 6. Tests Required

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib shared_context
cargo test --manifest-path src-tauri/Cargo.toml --test shared_context
cargo test --manifest-path src-tauri/Cargo.toml --test shared_session_v2
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  convert_event_preserves_replayed_user_message_as_raw_ack_evidence
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  context_import_requires_jsonrpc_success
pnpm vitest run \
  src/features/shared-session/runtime/sendSharedSessionTurnV2.test.ts
pnpm exec tsc --noEmit --pretty false
```

关键断言：

- 相同 source range 的 package id/checksum/stable prefix 确定。
- destination/capability/effective budget 改变时 package id 必须改变。
- artifact payload tamper 必须被读取复核拒绝；并发 writer 只能发布完整 payload。
- 当前 user prompt 不进入 prefix；accepted/committed 分阶段推进。
- artifact cross-workspace 拒绝且读取为 reference-only。
- strong ACK 缺失进入 recovery；弱 ACK 不伪装 exactly-once。
- frontend terminal event 缺失时，durable commit 仍结束 Shared send；Native Session
  tests 保持原行为。

### 7. Wrong vs Correct

#### Wrong

```ts
await sendSharedSessionMessage(...);
await sharedSessionV2AcceptContext(...); // 没有 Adapter 证据
```

#### Correct

```ts
const prepared = await sharedSessionV2PrepareDelivery(
  workspaceId,
  threadId,
  attemptId,
); // Tx3 已落盘
await sharedSessionV2DispatchTurn(workspaceId, threadId, {
  attemptId,
  artifactId: prepared.artifactId,
  artifactChecksum: prepared.artifactChecksum,
}); // dispatcher 内部验证真实 ACK 并按 durable owner accept
```

## Scenario: Shared Canonical History Envelope And Recovery Ownership

### 1. Scope / Trigger

- Trigger：修改 `src-tauri/src/shared_context/delivery.rs`、
  `src-tauri/src/shared_projection/projector.rs`、Shared history loader、统一 thread resume
  或 history recovery UI。
- 目标：canonical event 的 storage envelope 与 projector decode contract 永远一致；
  Shared history 故障不得被伪装为空历史，也不得掉入 Native recovery。

### 2. Signatures

```text
SharedEventWriter.append_canonical_fact_with_binding_at(
  sessionId,
  CanonicalFact,
  occurredAt,
  BindingStateUpdate,
)

StoredEvent {
  sessionId,
  sequence,
  factType,
  payloadJson,
  payloadChecksum,
  ...
}

SharedProjector.project_events(events)
createSharedHistoryLoader(...).load(threadId: "shared:<UUID>")
resumeThreadForWorkspace(workspaceId, threadId, ...)
```

Canonical payload 必须包含与 durable row 一致的 tagged discriminator：

```json
{
  "type": "context.deliveryPrepared",
  "attemptId": "attempt-...",
  "logicalTurnId": "turn-...",
  "packageId": "package-..."
}
```

### 3. Contracts

- 所有 future canonical facts MUST 通过 canonical writer serialization 写入；禁止业务模块
  手工构造 `NewCanonicalEvent` 后删除 `CanonicalFact.type`。
- event 与 `BindingStateUpdate` 必须继续在同一 SQLite transaction 提交；统一 envelope
  不能以牺牲 Binding 原子性为代价。
- projector decode 时，payload 已含 `type` 则必须与 row `fact_type` 完全相等；冲突、
  非 string tag 或非 object payload 必须 fail closed。
- 兼容既有 type-less object payload 时，projector MAY 在内存副本中注入同一 immutable
  row 的 `fact_type`，再走完整 `CanonicalFact` strong deserialize；禁止改写旧 row、
  checksum 或 schema。
- `sharedHistoryLoader` 只有在 Legacy snapshot 含可读 items 时才能对 projection error
  降级；Legacy 为空时必须传播原 projection error，禁止返回伪成功空快照。
- successful canonical `[]` 表示合法的新建空 Shared Session，必须标记 loaded；projection
  error 则保持 `loaded=false` 且下次 selection 可重试。
- Shared history lookup identity 永远是稳定 `shared:<UUID>`。`meta.title` 只作 presentation
  metadata，不得参与 storage key、retry scope 或 alias。
- Shared loader error MUST NOT 调用 Native Codex `resumeThread`、Claude JSONL history 或
  replacement-thread recovery；也不得写入 Native one-shot
  `automaticRecoveryFailedByScopeRef`。
- Messages MUST 以 `shared:` identity 屏蔽 Native history recovery card；Native Session
  原卡片与显式 retry 行为保持不变。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| future delivery fact | payload `type == fact_type`，event + Binding 原子提交 | 手工删 tag |
| old type-less delivery row | 以内存注入 row `fact_type` 后继续 projection/checkpoint | 修改 SQLite row/checksum |
| payload tag 与 row 冲突 | typed projection error，checkpoint 不前进 | 信任任一方继续投影 |
| projection error + readable Legacy | 可观测 V0 fallback | 丢弃 last-good history |
| projection error + empty Legacy | 向 resume boundary 传播 error | 返回正常空 snapshot |
| successful empty projection | Shared loaded empty | 标记 Native recovery failed |
| title 从默认值变为首条消息 | 继续用原 `shared:<UUID>` 恢复全部历史 | 按 title 新建/查找 session |
| Shared projection 暂时失败 | selection 可重试、无 Native RPC/card | 永久自动恢复锁、Native fallback |
| Native history 失败 | 保留既有 recovery card/action | 被 Shared gate 一并隐藏 |

### 5. Good / Base / Bad Cases

- Good：`prepare_delivery` / `accept_delivery` 直接提交 `CanonicalFact` 与 Binding；旧
  type-less row 由 projector tolerant decode，后续 `turnCommitted` 正常重建幕布。
- Base：V2 新会话没有任何 Turn，projection 返回 `[]`，Canvas 显示正常空态。
- Bad：catch projection error 后无条件使用空 Legacy items，统一 resume 把 Shared 写成
  Native `failed`，标题切换后再打开不再请求。
- Bad：只用 CSS 隐藏 recovery card，底层仍写
  `automaticRecoveryFailedByScopeRef`，导致会话永久不可自动恢复。

### 6. Tests Required

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test shared_context
cargo test --manifest-path src-tauri/Cargo.toml --test shared_projection
cargo test --manifest-path src-tauri/Cargo.toml --test shared_session_v2

npm exec vitest run -- \
  src/features/threads/loaders/sharedHistoryLoader.test.ts \
  src/features/threads/hooks/useThreadActions.shared-history.test.tsx \
  src/features/messages/components/Messages.history-loading.test.tsx

npm run typecheck
```

关键 assertion：

- prepared/accepted payload 的 `type` 与 row `fact_type` 相等，重复 delivery 不新增 fact。
- type-less delivery 前后存在 requested/committed facts 时，rebuild 仍恢复完整 items 并推进
  checkpoint；embedded type conflict 必须失败。
- title 更新前后 service 与 projection 均收到同一个 `shared:<UUID>`。
- projection failure + empty Legacy 可再次调用；Native `resumeThread` 调用次数为零。
- Shared 不渲染 Native recovery alert；Native 对照测试仍渲染并可点击 retry。

### 7. Wrong vs Correct

#### Wrong

```rust
let mut payload = serde_json::to_value(&fact)?;
payload.as_object_mut().map(|object| object.remove("type"));
writer.append_event_with_binding(&manual_event, &binding)?;
```

```ts
try {
  return await loadSharedProjection(workspaceId, threadId);
} catch {
  return legacyItems; // empty 也伪装成正常历史
}
```

## Scenario: Shared Cold-start Target Authority And Repair Guard

### 1. Scope / Trigger

- Trigger：修改 `load_shared_session`、`shared_sessions_v2.selected_target_json`、Shared
  history target hydration、Product catalog canonical repair 或 Composer mount effect。
- 目标：existing Shared Session 冷启动不得把尚未 hydrate 的空 target 解析成 global/default
  model 并持久化；V2 durable target 与 legacy meta 冲突时有唯一只读 authority。

### 2. Signatures

```text
SharedEventWriter.session_target(sessionId)
  -> Option<StoredSessionTarget { selectedTargetJson, updatedAt }>

resolve_shared_session_read_target(meta, eventWriter?)
  -> Result<Option<SharedSelectedTarget>, String>

load_shared_session(workspaceId, threadId)
  -> { selectedEngine, engineSource, selectedTarget, items, ... }

createSharedHistoryLoader(...).load(threadId)
  -> hydrateSharedTargetState(workspaceId, threadId, selectedTarget)

Composer automatic Product repair input
  = ResolvedExecutionTarget only
```

### 3. Contracts

- Desktop Shared read authority MUST be
  `shared_sessions_v2.selected_target_json > legacy meta.selectedTarget`；V2 row 缺失或 writer
  unavailable 时才允许 legacy fallback。
- `load_shared_session` 与 list summary MUST 从同一个 authoritative target 派生
  `selectedEngine` / `engineSource`；禁止 target=Kimi 但 summary=Codex。
- Cold-start read MUST be side-effect free：不得更新 V2 row、legacy meta、persist generation
  或 renderer selection cache。
- Product automatic repair MUST require an already resolved existing target。`null` / partial
  表示 hydration pending 或 legacy incomplete，不得送入 default resolver 后调用
  `set_shared_session_selected_engine`。
- History loader generation guard 只解决 concurrent user mutation 的 stale response；它不得
  为 mount/default mutation 提供合法性。
- 若旧 build 已把 V2 与 legacy 同时覆盖，系统 MUST NOT 仅凭最后一轮 Turn 猜测当前 mutable
  selection；恢复需要用户重新确认 target 或具备独立 mutation provenance。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| V2=Kimi，legacy=GPT | load/list 投影 Kimi | 读取 legacy GPT |
| V2 row 缺失 | 兼容 legacy target | 制造 catalog default |
| V2 JSON malformed | 返回可观察错误 | silent fallback 并写回 |
| Product ready + store target null | 等待 history hydration，零 selection IPC | 持久化首个 GPT row |
| resolved legacy alias | 可做一次 canonical repair | partial target repair |
| user picker persist 并发 history load | generation guard 保留用户 mutation | stale history 覆盖新选择 |

### 5. Good / Base / Bad Cases

- Good：legacy meta 是 GPT、V2 row 是 Kimi K3，load response 与 Composer 都显示 Kimi，两个
  store 在 read 前后字节/row 相等。
- Base：旧 session 没有 V2 row，完整 legacy target 继续可读；缺字段则 Composer 保持 blocked
  直到用户选择完整 model。
- Bad：`resolveProductManagedExecutionTargetV1({ target: null })` 返回首个 GPT 后，mount effect
  直接调用 selection persistence；persist generation 随后让真实 Kimi history response 失效。

### 6. Tests Required

- Rust：构造 `legacy=Codex/GPT`、`V2=Kimi/k3-256k`，断言
  `resolve_shared_session_read_target` 返回 V2 且 read 前后两份存储不变。
- Composer：Product entitlement ready + Shared target store null，mount/flush effects 后断言
  `set_shared_session_selected_engine` 调用次数为 0、store 仍为 null。
- History loader：response 含完整 Kimi target 时断言 target store 与 snapshot engine 使用 Kimi。
- Layout：断言 `selectedModelRuntime` 与 `onPersistNativeSessionTarget` 从 AppShell options 到
  Composer production entry 完整透传。
- L3 gate：affected Vitest、targeted ESLint、typecheck、runtime contracts、Rust focused test、
  `cargo check --lib` 与 daemon compile。

### 7. Wrong vs Correct

#### Wrong

```ts
const repaired = resolveProductManagedExecutionTargetV1({
  target: selectedSharedTarget, // hydration 期间可能为 null
  engines,
  models,
});
handleSharedTargetChange(repaired); // 把 default 当 user mutation 写盘
```

#### Correct

```ts
const repaired = isResolvedExecutionTarget(selectedSharedTarget)
  ? resolveProductManagedExecutionTargetV1({
      target: selectedSharedTarget,
      engines,
      models,
    })
  : null;
if (repaired && !isSameExecutionTarget(selectedSharedTarget, repaired)) {
  handleSharedTargetChange(repaired);
}
```

```rust
let selected_target = writer
    .session_target(&meta.id)?
    .map(parse_target)
    .transpose()?
    .or_else(|| meta.selected_target.clone());
// read projection only; no upsert/write_shared_session_meta
```

#### Correct

```rust
writer.append_canonical_fact_with_binding_at(
    session_id,
    fact,
    occurred_at,
    &binding,
)?;
```

```ts
try {
  return await loadSharedProjection(workspaceId, threadId);
} catch (error) {
  if (legacyItems.length === 0) {
    throw error;
  }
  return legacyItems;
}
```
