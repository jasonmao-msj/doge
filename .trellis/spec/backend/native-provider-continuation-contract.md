# Native Provider Continuation Contract

## Scenario: 从既有 Native Session 创建独立的跨 Provider 续接

### 1. Scope / Trigger

- Trigger：修改 `native_history/**`、`native_continuation/**`、session catalog lineage、
  Codex cross-provider fork、`createNativeProviderContinuation` 或 Sidebar 续接入口。
- 目标：来源 vendor history 只读；目标 side effect 前持久化 immutable materialization；
  retry 不盲建；Continuation 保持顶层且不冒充 Subagent。

### 2. Signatures

```rust
prepare_native_provider_continuation(
    workspace_id,
    operation_id,
    source: NativeHistorySource,
    destination: ExecutionTargetInput,
) -> Result<Value, String>

discard_prepared_native_provider_continuation(
    workspace_id,
    operation_id,
    source: NativeHistorySource,
    destination: ExecutionTargetInput,
) -> Result<bool, String>

create_native_provider_continuation(
    workspace_id,
    operation_id,
    source: NativeHistorySource,
    destination: ExecutionTargetInput,
    confirm_degraded,
) -> Result<Value, String>
```

```typescript
prepareNativeProviderContinuation(request): Promise<NativeProviderContinuationResponse>
discardPreparedNativeProviderContinuation(request): Promise<boolean>
createNativeProviderContinuation({
  workspaceId,
  operationId,
  source,
  destination,
  confirmDegraded?,
}): Promise<NativeProviderContinuationResponse>

structured_claude_api_error(event) -> Option<(message, code)>
structured_claude_result_error(event) -> Option<(message, code)>
```

### 3. Contracts

- source identity validation MUST 按 Engine 处理：Claude/Kimi 的 `source.sessionId`
  MUST 等于 `<engine>:<nativeSessionId>`；Codex MAY 使用 exact raw
  `nativeSessionId` 或 `codex:<nativeSessionId>`。两种 Codex 表示都 MUST 映射到同一
  native thread，且 MUST 保留 caller 提供的 exact logical `sessionId` 用于
  materialization、lineage 与来源导航。Codex source MUST 带 authoritative
  `providerProfileId`。
- Continuation artifact 存储 MUST 使用 platform-safe 的确定性 path key（如
  `sha256(sessionId)` 短前缀），禁止将 logical `sessionId`（`<engine>:<native>`）
  直接作为 filesystem path segment；Windows 下 `:` 会触发 `ERROR_DIRECTORY (267)`。
  Record JSON 内 MUST 保留原始 `sessionId`；读取 MUST 兼容 legacy
  `{sessionId}` 目录布局，保证升级前 artifact 可读，且
  `scan_orphan_artifacts` 不得因路径布局变化误删被引用 artifact。
- destination V1 支持 Claude/Codex。Kimi target 与 remote daemon MUST 返回 typed
  `unsupported-target-acceptance`，禁止 fallback。
- phase 顺序：`prepared -> creating -> ready`；不确定 ACK 进入
  `recovery-required`。相同 `operationId` + 相同 request 复用 artifact/target identity；
  request 不同返回 `operation-conflict`。
- `prepare_native_provider_continuation` MUST 只冻结 source artifacts、编译 Context
  Package 并返回真实 source/package token estimate；MUST NOT 创建 target Session、发送
  Context 或写 target catalog identity。
- preview 的 `sourceEstimatedTokens/packageEstimatedTokens` 是 deterministic portable-history
  与 continuation-package estimate，不是 Provider-reported current context 或 billing Token；
  UI MUST 明确展示“可移植历史 → 续接包”方向。
- `discard_prepared_native_provider_continuation` MUST 重新计算 request checksum，且只删除
  checksum 匹配、phase=`prepared`、`result_session_id IS NULL` 的 operation。Content-addressed
  artifacts MAY 保留复用；`creating/ready/recovery-required` MUST 不受影响。
- `prepared` 且尚无 target side effect 时，旧版本 checksum 或损坏 artifact MAY 删除旧
  prepared operation 后按同一 request 重新 materialize；`creating/ready/recovery-required`
  MUST 保留 durable identity 并 fail closed。
- Native history 单文件读取 MUST 有明确 byte limit，并在 blocking worker 中执行；超限返回
  typed `source-too-large`，禁止在 async runtime worker 上无界读取。
- Codex native history MUST 以 frozen cursor 内最后一个有效
  `compacted.payload.replacement_history` 作为 effective window，并追加该 compaction 之后的
  portable delta；superseded window MUST NOT 进入 normalized artifact。Replacement 内
  private/unknown block 继续执行既有 omission，禁止因 compaction replay 放宽 allowlist。
- Reader 只允许 portable text 与完整 Tool Call/Result pair；private reasoning、
  signature/encrypted/redacted block 与 unknown block MUST omission，禁止泄露到目标 Provider。
- Context Package budget MUST 与 transport capability 解耦：Claude prompt 与 Codex
  `thread/inject_items` 都必须先生成 budgeted delta；structured import MUST NOT 绕过 budget。
  Oversized atomic Tool Exchange MUST 保持 Call/Result pairing 并使用 deterministic bounded
  evidence。多个 Turn 先移除最旧完整 Turn；最后一个 oversized Turn MUST 至少保留 User intent
  与 latest Assistant outcome（存在时）。Portable source 非空时 package MUST 满足
  `0 < packageEstimatedTokens <= budget`；否则 fail closed，禁止 target side effect。
- Codex runtime、operation `resultSessionId`、catalog row 与 frontend selection MUST
  统一使用裸 `<thread-id>`。Continuation metadata stable key MUST 规范化为
  `codex:<workspace-id>:<thread-id>`；读取时 MUST 兼容历史
  `codex:<workspace-id>:codex:<thread-id>` duplicated key，但不得继续写入该格式。
  Source operation/materialization MUST 保留已验证的 raw 或 prefixed logical identity，
  禁止仅为通过校验而重写来源 `sessionId`。
- catalog projection MUST 以 exact `sourceSessionId` 递归解析 continuation metadata，
  重建 `familyId/rootSessionId/depth`；resolver MUST 有 cycle guard。该兼容层只修正
  projection，不得迁移 native history 或复制 target Session。
- Codex `thread/inject_items` capability MUST 由无目标副作用的 JSON-RPC method probe
  决定；`method not found` 才视为 unsupported。unsupported 时 MUST 使用已声明的
  portable prompt transport，禁止仍调用缺失 method。
- Claude 首次 bootstrap 以目标 session identity、冻结 artifact checksum 和 CLI
  invocation 成功返回作为 accepted evidence；模型是否逐字复述 marker 不得决定创建成功。
- Claude continuation bootstrap MUST 使用 engine-private `ContextBootstrap` command
  profile：`--safe-mode`、`--tools ""`、`--disable-slash-commands`、
  `--prompt-suggestions false`、minimal `--system-prompt`、disable thinking，并跳过
  curated skill、activation hint、AskUser MCP 与 hook events。普通 send path MUST 固定使用
  `Standard` profile，不得改变 tools/skills/MCP/permission contract。
- Claude recovery 只复用既有 target identity，并检查 durable history：user entry 必须
  同时包含 exact package marker 与 `MOSSX_NATIVE_CONTEXT_V1`，或 assistant exact echo
  acceptance marker。仅出现 marker 字样不是证据。当前 bootstrap user entry 之后的
  structured `isApiErrorMessage` / `apiErrorStatus` 是强负 evidence，MUST 覆盖 user-entry
  persistence、acceptance marker、process error 与 connector warning。
- Claude live stream MUST 同时识别 camelCase 与 snake_case API-error evidence：
  `isApiErrorMessage` / `is_api_error_message`、`apiErrorStatus` /
  `api_error_status`；缺少 numeric status 时 MAY 从标准 `API Error: <status>` 文本提取。
  `result.is_error=true` 或 `result.subtype=error` 同样是 authoritative terminal error。
  上述 evidence 到达后 MUST 立即 emit exactly one `TurnError`、停止 stdout read，并终止
  exact process group；process exit/EOF/stderr drain 只属于 cleanup，MUST NOT 继续阻塞
  continuation command 或普通 Claude turn。
- destination `modelCatalogEntryId` 保存 UI selection identity；destination `model` 保存
  CLI runtime identity。Claude backend MUST 在 target side effect 前用 Provider-scoped
  catalog 校验两者；已知 UI-only id 返回 `invalid-target-model`。
- bootstrap turn id 使用 `provider-continuation-*`；renderer event ingress MUST 在统一入口
  隔离该 control exchange，禁止进入普通 processing/reasoning/message/title 链。
- legacy degraded response MUST 保留 `projectionMode`、`omissions`、
  `sourceEstimatedTokens`、`packageEstimatedTokens` 与 `adapterDroppedEntries` 供诊断；
  prepare preview MUST 至少返回 fidelity 与 source/package token estimate。
- Backend MUST 只在真实 boundary emit operation-scoped
  `native-provider-continuation-progress`：`reading-source / compiling-context / prepared /
  starting-target / delivering-context / verifying-target / finalizing / ready`。Frontend
  MUST 按 workspace + operation 过滤，禁止 timer、polling 或 elapsed-time interpolation。
- catalog MUST 保存 Provider Binding、Origin 与 Conversation Family；MUST NOT 写
  `parentThreadId`。删除来源 MUST NOT 级联删除 Continuation。

### 4. Validation & Error Matrix

| 条件 | 结果 | 禁止行为 |
|---|---|---|
| stable cursor 不可证明 | `unsupported-stable-cursor` | 写 materialization / 创建目标 |
| source identity 或 Provider 漂移 | typed validation error | 从其他 Provider 猜来源 |
| operation 参数变化 | `operation-conflict` | 复用旧 artifact |
| preview 取消 | guarded delete prepared operation | 删除共享 artifact / target identity |
| prepared、无 target side effect 且 artifact checksum 失败 | 删除旧 prepared 后重新冻结 | 复用损坏 artifact |
| 已触发 target side effect 后 artifact checksum 失败 | `recovery-required` | 重读来源或新建第二目标 |
| target side effect 后 ACK 不确定 | `acceptance-ambiguous` | 创建第二个目标 |
| bootstrap 后 target history 有 structured API rejection | `target-provider-rejected`，保留同一 target identity | marker/user entry 将 operation 转 ready |
| live stream API rejection 后 stdout 仍保持 open | 立即 `TurnError` + exact process-group cleanup | 等待 EOF/result 导致 Dialog 永久 `running` |
| `result.is_error=true` 且没有 assistant error event | terminal `claude_result_error` | 投影为成功 `TurnCompleted` |
| catalog entry `id != model` | runtime 使用 `model`，backend 校验 | UI `id` 进入 Claude `--model` |
| Claude CLI 完成但模型未复述 marker | 按同一 target identity 持久化 ready | 报假失败并要求重复创建 |
| recovery history 有完整 bootstrap user entry | 复用既有 target 并补 catalog | 只认模型输出、创建第二个 target |
| metadata 写入失败 | `catalog-commit-failed` | 丢失 result identity |
| remote daemon | typed unsupported | local/default fallback |

### 5. Good / Base / Bad Cases

- Good：Claude Provider A → Codex Provider B → 原 Claude Provider；每一步创建独立顶层
  Session，继承 family，保留来源链。
- Base：package 无 omission，直接创建；同 operation retry 返回同一 target。
- Bad：复制 Codex rollout 到另一个 `CODEX_HOME`，或把
  `lineageParentSessionId` 填入 `parentThreadId`。
- Bad：把模型是否严格服从“只回 marker”当 transport ACK；这会造成首次假失败、第二次才恢复。
- Bad：Claude recovery 只做 `jsonl.contains(marker)`；普通用户文本也可能包含相同字样。
- Bad：只在 transcript scanner 识别 camelCase rejection，却让 live stdout 的
  `is_api_error_message` 继续走 assistant text；离线状态正确但前台会无限等待 EOF。

### 6. Tests Required

- Rust：Reader append/drift/corrupt、operation conflict/phase/result identity、artifact checksum、
  byte limit、private/unknown omission、atomic Tool pair、Codex method probe/portable fallback、
  raw Codex target identity、legacy duplicated metadata key、recursive family/cycle guard、
  closed import envelope、Claude completed bootstrap、durable bootstrap history、
  assistant exact ACK compatibility、unrelated marker rejection、catalog family/delete non-cascade。
- Rust：额外覆盖 Codex last-compaction effective window、replacement private omission、
  structured import budget、atomic Tool bounded fold、single oversized Turn non-empty spine 与
  empty portable source fail-closed。
- Rust：source identity truth table MUST 覆盖 raw Codex、prefixed Codex、Codex mismatch，
  以及 Claude/Kimi raw rejection 与 prefixed acceptance。
- Vitest：prepare/discard/create DTO mapping、Claude/Codex target menu、double-click guard、
  cancellation late-completion race、single confirmation、operation progress 过滤、Token 摘要、
  omission negative assertion、canonical target selection、顶层“供应商续接”标签与来源导航、
  Codex Provider Continuation leading host bootstrap 隐藏与普通 Codex Session 隔离、
  普通与 pinned Continuation Family 默认折叠及 disclosure 展开/收起。
- Rust：额外覆盖 `ContextBootstrap` command args、普通 command wrapper、progress milestone
  单调性与 prepared guarded discard。
- Rust：Claude stream tests MUST 覆盖 camelCase/snake_case API-error assistant、
  `result.is_error=true`、error 后 child 继续持有 stdout；断言 bounded settlement、
  active process owner 清空、一个 `TurnError`、零 `TurnCompleted`。
- Contract：`cargo check --lib`、`npm run typecheck`、
  `npm run check:runtime-contracts`、OpenSpec strict validation。
- Release gate：真实 Desktop 执行 Claude A → Codex B → Claude A，人工观察历史连续性、
  single confirmation、阶段 progress、bootstrap elapsed time 与 recovery；自动化不可替代。

### 7. Wrong vs Correct

#### Wrong

```rust
if history_jsonl.contains(&marker) {
    mark_ready();
}
```

#### Correct

```rust
let accepted = bootstrap_completed
    || history_has_exact_package_and_native_version(history_jsonl)
    || assistant_text_blocks(history_jsonl)
        .any(|text| text.trim() == marker);
if accepted {
    commit_existing_target_identity();
}
```

#### Wrong: structured API error waits for process EOF

```rust
if let EngineEvent::TurnError { .. } = event {
    emit(event);
    continue; // stdout may remain open forever
}
```

#### Correct: logical error settles before cleanup

```rust
if let EngineEvent::TurnError { .. } = event {
    emit(event);
    break 'stream;
}
force_kill_exact_process_group().await;
return Err(provider_error);
```

## Scenario: Provider Continuation Product Projection

### 1. Scope / Trigger

- Trigger：修改 Continuation 入口、确认 UI、catalog title、幕布消息或来源导航。

### 2. Signatures

```ts
classifyContextProtocolText(text): ContextProtocolKind | null
ProviderContinuationDialog({ state, onCancel, onConfirm })
ProviderContinuationContextCard({ thread, source, onOpenSource })
```

### 3. Contracts

- 点击目标 Provider 后 MUST 打开 application-owned Dialog 并调用 prepare-only command；
  prepare 完成前 primary button disabled，首次 confirm 前 MUST NOT 调用
  `createNativeProviderContinuation`。
- Dialog MUST 展示可读 title、完整 source → destination、真实 source/package token、
  三阶段 strip 与底部 progress；MUST NOT 展示 protocol marker、projection mode、
  omissions 或 adapter drops。
- prepared package 即使 degraded，也 MUST 由同一次“继续”以
  `confirmDegraded: true` 执行；MUST NOT 进入第二个 degradation confirmation。
- prepare 期间取消 MUST 立即关闭并 guarded discard；late completion MUST 再次幂等
  discard，且 MUST NOT 重开 stale Dialog。
- recovery 主文案 MUST 面向用户解释“是否可能已创建、重试是否会重复”；raw backend
  error 只能放在默认折叠的“技术详情”。
- renderer production code MUST NOT 使用 `alert/window.alert` 或 native system confirm。
- exact `MOSSX_CONTEXT_PACKAGE/ACCEPTED` MUST 按 package identity 形成可嵌套的
  closed envelope：从 package
  marker 起到 matching accepted marker 止，所有 user/developer/assistant/reasoning/
  lifecycle projection MUST 全部隐藏；nested envelope MUST 用 identity-aware stack，
  不得在内层 accepted marker 提前结束；外层 matching accepted MUST 一并清除其内部旧版
  未闭合 package marker。完整 native context prompt 启动 legacy control exchange，
  直到下一条普通 user message 前隐藏；shared runtime prompt 只隐藏其 exact echo。
  普通包含 MOSSX 的用户文本 MUST 保留。
- Codex app-server 在 continuation control prompt 之前注入的完整
  `<environment_context>...</environment_context>`，以及 control prompt 后、第一条真实
  user turn 前的 bootstrap reasoning/assistant output，MUST 仅在 catalog authoritative
  `originKind=provider-continuation` 且 active engine 为 Codex 时由 Messages presentation
  boundary 隐藏。该 gate MUST 纳入 presentation cache identity 与 control-tail 检测；
  普通 Codex Session、Claude continuation、Shared V2 conversation 与第一条真实 user turn
  之后的正文 MUST 保持既有语义。禁止在 vendor history loader 或 streaming reducer 中做
  全局 substring 删除。
- protocol title MUST 投影为“继续：来源标题”或可读 fallback。
- continuation metadata MUST 通过既有 `.messages` timeline-leading slot 接入，默认折叠，
  不得成为 Canvas 根 sibling，也不得参与 message grouping、streaming、terminal 或
  scroll-anchor 计算。展开后显示 source → target snapshot；来源缺失时 disabled。
- Sidebar 中含两个及以上可见 top-level member 的 Continuation Family MUST 默认折叠，
  仅保留当前排序最前的代表 Session 与完整成员数。`续接会话 · {{count}} 个` MUST 是带
  `aria-expanded` 的 disclosure control；展开后恢复全部既有 member 顺序，再次触发恢复
  折叠。该状态只属于当前 `ThreadList` local UI state，MUST NOT 新增 backend、catalog 或
  persistent preference。
- operation ready 后 frontend MUST await 既有 workspace catalog reload Promise，再关闭
  Dialog 并选择 exact target id。Refresh settle 前 target MUST NOT 进入 Canvas；禁止用
  fixed delay、polling、provisional Session row 或第二份 continuation registry 规避
  metadata 时序。这样 target Canvas 首帧即可同时获得 engine 与 authoritative
  `provider-continuation` origin，避免 host bootstrap 先显示再隐藏。

### 4. Validation & Error Matrix

| 场景 | 结果 | 禁止行为 |
|---|---|---|
| preview 取消 | 无 target side effect；prepared operation guarded discard | 先创建再询问 / stale completion 重开 |
| degraded | Token 摘要内一次产品确认 | native Alert / omissions 明细 / 二次确认 |
| recovery retry | 复用同一 operation；只校验同一 target | 创建第二个 target |
| bootstrap control exchange | 整段幕布隐藏 | hash/reasoning/问候作为普通聊天显示 |
| 普通用户讨论 marker | 正常显示 | 宽泛 substring 误删 |
| 来源缺失 | 卡片解释并禁用导航 | 跳到同名/相邻 Session |

### 5. Good / Base / Bad Cases

- Good：Dialog 自动 prepare，显示 Claude A → Codex B 与 Token；取消只调用 discard；
  一次确认后创建。
- Base：ready continuation 显示可读标题和默认折叠的来源 metadata。
- Bad：把 `MOSSX_CONTEXT_PACKAGE:sha256:...` 当 Sidebar title 和 user bubble。

### 6. Tests Required

- Dialog confirm/cancel/degraded/recovery retry tests。
- Sidebar command-before-confirm negative assertion 与 Kimi disabled state。
- complete control exchange classifier + Messages render regression。
- readable title、source card navigation 与 missing-source tests。

### 7. Wrong vs Correct

#### Wrong

```ts
if (window.confirm(message)) {
  await createNativeProviderContinuation(request);
}
```

#### Correct

```ts
setDialogState({ stage: "preparing", request });
void prepareNativeProviderContinuation(request);
// create command 仅由 Dialog 的一次 confirm handler 调用
```
