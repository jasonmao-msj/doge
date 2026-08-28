# native-provider-continuation Specification

## Purpose

定义 Native Session 跨 Provider 续接的冻结、创建、恢复和用户可见失败契约；目标是创建独立的新 Native Session，同时完整保留来源。

## Requirements

### Requirement: Provider Continuation MUST Create A New Native Session

用户选择“使用其他 Provider 继续”时，系统 MUST 冻结来源 Target Snapshot，创建新的 Native
Session 与目标 Provider Binding，并保持来源 Session 不变。

#### Scenario: cross-provider continuation succeeds

- **WHEN** 用户从 Provider A 的 Native Session 选择可用 Provider B
- **THEN** 系统 MUST 创建新的 Provider B Native Session
- **AND** MUST NOT 删除、修改、归档或重新绑定来源 Session

#### Scenario: same provider is not a provider continuation

- **WHEN** 用户选择与来源相同的 Engine 与 Provider Profile
- **THEN** UI MUST 阻止 Provider Continuation 创建
- **AND** MAY 引导用户使用既有 continue/fork 能力

### Requirement: Provider Continuation MUST Prepare Before Target Side Effects

系统 MUST 在创建目标 Native Session 或发送 Context 前，持久化 immutable normalized
entries artifact、ContextPackage artifact 与 `NativeHistoryMaterialization`。

#### Scenario: retry reuses frozen artifacts

- **WHEN** prepared operation 因目标 unavailable 而重试，且来源 history 已增长或删除
- **THEN** retry MUST 校验并复用原 artifact refs/checksums
- **AND** MUST NOT 重读来源生成不同 Context

#### Scenario: artifact integrity fails

- **WHEN** operation 已进入 `creating`、`ready` 或 `recovery-required` 后 artifact 缺失或 checksum 不匹配
- **THEN** operation MUST 进入 explicit `recovery-required`
- **AND** MUST NOT 重读来源或创建第二个目标 Session

#### Scenario: stale prepared artifact is repaired before side effects

- **WHEN** a legacy or corrupted artifact belongs to a `prepared` operation with no result Session
- **THEN** the system MUST delete only that prepared operation and rebuild from the same validated request
- **AND** operations at `creating`, `ready`, or `recovery-required` MUST NOT use this repair path

### Requirement: Provider Continuation MUST Recover Idempotently

operation id、目标 Native identity 与 phase MUST durable；目标 side effect 后 transport
evidence 不确定时，系统 MUST 先 probe，不得 blind retry。Provider continuation bootstrap
MUST NOT 以模型精确复述 marker 作为唯一成功条件；目标 identity、冻结 artifact checksum
与 target history/runtime 的 durable delivery evidence MUST 构成 acceptance 判断。

#### Scenario: crash after target creation

- **WHEN** App 在目标 Native Session 已创建但 metadata commit 前崩溃
- **THEN** 重启后 MUST 依据 durable operation/result identity probe
- **AND** MUST NOT 自动创建第二个 Native Session

#### Scenario: model does not echo marker

- **WHEN** target Session 已创建且完整 bootstrap entry 已在对应 target history/runtime evidence 中持久化，但模型没有精确回复 acceptance marker
- **THEN** operation MUST 依据 durable transport evidence 进入 `ready`
- **AND** MUST NOT 把模型服从性失败报告为 target 创建失败

#### Scenario: target exists but delivery evidence is temporarily unreadable

- **WHEN** target identity 已持久化但 bounded probe 暂时无法确认 bootstrap delivery
- **THEN** operation MUST 进入 `recovery-required`
- **AND** retry MUST probe 同一 target identity 而不是创建第二个 Session

### Requirement: Provider Continuation MUST Expose Fidelity And Failure

Reader omissions、Context Package degraded mode、unsupported 与 recovery state MUST 可诊断；需要 lossy projection 时 MUST 在 target side effect 前经过一次产品确认。正常确认 UI MUST 展示 token estimate 与 compact fidelity summary，MUST NOT 展示逐条 omissions、projection mode、adapter drop 或 raw protocol marker。

#### Scenario: lossy context is included in the unified confirmation

- **WHEN** prepared package 包含 `not-retrievable` omission、checkpoint degradation 或 adapter drop
- **THEN** UI MUST 在统一 Dialog 展示 source/package token estimate
- **AND** 同一次“继续”确认 MUST 同时授权 destination 与该 frozen package fidelity
- **AND** MUST NOT 再显示第二个 degradation confirmation
- **AND** 未确认前 MUST NOT 创建目标 Session 或发送 Context

#### Scenario: fidelity diagnostics remain available outside the primary UI

- **WHEN** degraded preparation 或 execution 需要诊断
- **THEN** backend response 与 logs MUST 保留 structured fidelity evidence
- **AND** primary Dialog MUST NOT 把 omissions list 或 raw technical mode 作为用户决策内容

### Requirement: Codex Import Capability MUST Be Probed

Codex continuation MUST probe `thread/inject_items` support without creating or mutating the target
Session. Only a JSON-RPC method-not-found response proves unsupported capability.

#### Scenario: Codex import is unavailable

- **WHEN** the probe returns JSON-RPC method not found
- **THEN** the continuation MUST use its declared portable prompt transport
- **AND** it MUST NOT call `thread/inject_items` after classifying the method unsupported

### Requirement: Provider Continuation MUST Use Product-Controlled Confirmation

Provider Continuation MUST use a product-controlled, accessible dialog to prepare, preview and confirm the target and compact fidelity summary before creating target-side effects. The flow MUST NOT use browser or platform-native alert/confirm dialogs. Dialog MUST distinguish preparing, prepared confirmation, target delivery, verification, ready, and recoverable states; raw technical codes MUST NOT be the only user-facing explanation.

#### Scenario: user previews a continuation target

- **WHEN** the user chooses an available destination Provider Profile
- **THEN** the system MUST present a Provider switch icon, readable source title, source, destination CLI, Provider Profile, selected Model and estimated Context tokens in a product-controlled dialog
- **AND** MUST show three compact stages for Context preparation, Provider startup, and verification/completion
- **AND** MUST NOT create the target Native Session until the user confirms

#### Scenario: preparation requires lossy projection

- **WHEN** prepare-only preview reports degraded fidelity
- **THEN** the same product-controlled dialog MUST keep the compact token summary
- **AND** MUST NOT render an omissions list, raw projection mode, adapter drop list, or a second degradation confirmation
- **AND** the single primary confirmation MUST execute the already frozen operation with degradation accepted

#### Scenario: recoverable target reports next action

- **WHEN** a target Session exists but bootstrap verification is temporarily unresolved
- **THEN** the dialog MUST explain that the source is unchanged and the target will not be recreated
- **AND** MUST offer a bounded re-probe or opening the known target when safe
- **AND** technical diagnostics MUST be secondary, copyable detail

#### Scenario: native confirmation APIs remain unused

- **WHEN** the continuation requires confirmation or reports an error
- **THEN** the UI MUST render the state using application components
- **AND** MUST NOT invoke `window.alert`, `window.confirm`, Tauri `ask`, or Tauri `confirm`

### Requirement: Provider Continuation Capability Boundaries MUST Be Visible

The destination picker MUST expose registered CLIs and Provider Profiles with their verified continuation-target capability state. An engine verified only as a source MUST remain disabled as a destination with a human-readable reason.

#### Scenario: Kimi is source-only

- **WHEN** Kimi is registered but continuation target acceptance has not been verified
- **THEN** the destination picker MUST keep Kimi visible but disabled
- **AND** MUST explain that Kimi can be a source while target continuation is not yet available

### Requirement: Provider Continuation MUST Expose Readable Identity And Source Navigation

A ready Provider Continuation MUST have a human-readable title and a discoverable relationship to its source Session. The relationship projection MUST be a compact, collapsible metadata row inside the existing message scroll flow and MUST NOT alter ordinary message grouping, streaming, completion, or scroll-anchor semantics.
Its interactive header MUST remain fully visible and operable while collapsed or expanded, MUST account for the shared Canvas topbar safe offset, and MUST NOT be clipped behind Canvas chrome during the toggle interaction. Source navigation MUST use a compact icon-only action without visible button text or resting button chrome while preserving an accessible name, tooltip, keyboard interaction, and disabled semantics.
When source messages are already available in the client, expanded metadata MUST expose a compact deterministic excerpt of the source Session's latest readable turn without rendering a second Messages Canvas or triggering implicit history loading.

#### Scenario: continuation becomes ready

- **WHEN** a Provider Continuation target Session reaches ready
- **THEN** its sidebar/canvas identity MUST use a readable title instead of a protocol marker
- **AND** the canvas MUST expose source and target snapshots in a compact row that is collapsed by default
- **AND** the user MUST be able to open the source Session when it is still available

#### Scenario: continuation metadata is absent

- **WHEN** a Native Session is not a Provider Continuation or its metadata row is not rendered
- **THEN** the ordinary Messages DOM order, grouping, final separator, processing completion, and scroll-anchor behavior MUST remain unchanged

#### Scenario: source session is unavailable

- **WHEN** the recorded source Session no longer exists or is inaccessible
- **THEN** the continuation identity MUST remain readable from frozen snapshots
- **AND** source navigation MUST be disabled with an explicit explanation
- **AND** the source excerpt MUST use an unavailable fallback rather than stale or fabricated content

#### Scenario: continuation metadata is toggled near the Canvas header

- **WHEN** the compact metadata row is collapsed or the user expands it while Messages is anchored near an edge
- **THEN** the row header MUST remain fully visible below the shared Canvas topbar and above message content
- **AND** the user MUST be able to activate the same header again to restore the collapsed state

#### Scenario: source navigation is presented in expanded metadata

- **WHEN** the continuation metadata row is expanded and its source navigation is available
- **THEN** the navigation action MUST render as an icon without visible text, border, or resting background
- **AND** it MUST preserve an accessible name, tooltip, keyboard activation, and a visible hover or focus state

#### Scenario: latest source turn is already loaded

- **WHEN** the source Session has loaded readable message items
- **THEN** expanded metadata MUST show the last non-empty user message and the latest non-empty assistant message after it
- **AND** trailing tool, reasoning, plan, or other non-message items MUST NOT change the selected excerpt
- **AND** long text MUST remain visually bounded while full source navigation remains available

#### Scenario: latest source turn is incomplete

- **WHEN** the source Session has a last non-empty user message without a following readable assistant message
- **THEN** expanded metadata MUST show the available user excerpt without fabricating an assistant response

#### Scenario: source messages are not loaded

- **WHEN** the source Session identity is available but its message items are absent or contain no readable text
- **THEN** expanded metadata MUST show an explicit not-loaded or empty fallback
- **AND** opening the metadata MUST NOT trigger implicit history loading

### Requirement: Composer Provider Selection MUST Reuse Provider Continuation

Native Composer 从其他 Provider Profile 选择 Model 时 MUST 复用产品内 Provider Continuation Dialog 与现有 idempotent continuation operation；目标 snapshot MUST 包含用户选择的 Model。Sidebar context menu 与 Composer MUST 共享 prepare-only preview、一次确认、progress 与 recovery contract。

#### Scenario: cross-provider model opens continuation preview

- **WHEN** 用户在 Native Composer 选择与来源 binding 不同的可用 Provider Profile 与 Model
- **THEN** 系统 MUST 展示现有 Provider Continuation Dialog 并开始无 target-side-effect preparation
- **AND** Dialog MUST 展示来源 Session 与目标 CLI、Provider Profile、Model identity 和 estimated Context tokens
- **AND** 确认前 MUST NOT 创建目标 Session

#### Scenario: confirmation freezes selected model

- **WHEN** 用户确认由 Composer 发起的 Provider Continuation
- **THEN** continuation destination MUST 包含点击时选择的 Model
- **AND** 后续 picker 或 active engine 变化 MUST NOT 改写该 operation 的目标 snapshot

#### Scenario: cancellation preserves source session

- **WHEN** 用户取消由 Composer 发起的 Provider Continuation Dialog
- **THEN** 来源 Session、Provider binding 与 Model selection MUST 保持不变
- **AND** 系统 MUST 丢弃仍处于 prepared 且无 target identity 的 operation
- **AND** MUST NOT 创建目标 Session 或发送 Context

#### Scenario: context menu and composer share one preparation contract

- **WHEN** Provider Continuation 从 sidebar context menu 或 Native Composer 发起
- **THEN** 两个入口 MUST 使用相同的 source snapshot、operation idempotency 与 Dialog state preparation
- **AND** 两个入口 MUST 使用相同的一次确认、progress 与 recovery path

### Requirement: Provider Continuation MUST Freeze Runtime Model Identity

Provider Continuation 从 Provider-scoped catalog 选择模型时，destination MUST 将 catalog
entry identity 与 CLI runtime model 分开冻结。CLI invocation MUST 使用 runtime model；
catalog entry id MUST NOT 作为 runtime model 发送。

#### Scenario: catalog id differs from runtime model

- **WHEN** 用户选择的 catalog entry `id` 为 `settings-reasoning` 且 runtime `model` 为
  `deepseek-v4-pro`
- **THEN** continuation destination MUST 冻结两种 identity
- **AND** Claude CLI MUST 接收 `deepseek-v4-pro`
- **AND** MUST NOT 接收 `settings-reasoning`

#### Scenario: backend receives a proven UI-only model id

- **WHEN** Claude continuation payload 的 model 命中 Provider-scoped catalog entry id，且该
  entry 的 runtime model 不同
- **THEN** backend MUST 在 target identity 或 target-side effect 创建前返回
  `invalid-target-model`
- **AND** MUST NOT 静默把该 UI-only id 发送给 Claude CLI

#### Scenario: custom model is not present in catalog

- **WHEN** continuation payload 包含通过 shape validation 的 non-empty custom runtime model，
  且它不命中 catalog entry id
- **THEN** backend MUST 保留既有 custom model passthrough
- **AND** MUST NOT 引入 official-model allowlist

### Requirement: Provider Continuation Recovery MUST Prefer Explicit Rejection

Claude continuation recovery MUST 将当前 bootstrap 之后的结构化 Provider/API rejection
视为强负 evidence。Explicit rejection MUST 优先于 bootstrap user-entry、acceptance marker、
process error 与无关 stderr warning。

#### Scenario: bootstrap entry is followed by API rejection

- **WHEN** 同一 target history 含当前 package 的完整 bootstrap user entry，且其后 assistant
  entry 带 `isApiErrorMessage=true` 或 `apiErrorStatus`
- **THEN** operation MUST 记录 `target-provider-rejected`
- **AND** MUST NOT 进入 `ready`
- **AND** retry MUST probe 同一 target identity，MUST NOT 创建第二个 target

#### Scenario: source context mentions an old API error

- **WHEN** bootstrap user entry 的 Context Package 文本提及旧 `API Error`，但当前
  bootstrap 后没有结构化 rejection
- **THEN** recovery MUST NOT 把来源文本当成当前 target rejection

#### Scenario: process error conflicts with durable target rejection

- **WHEN** Claude process 返回 connector warning 或其他 runtime error，且 target history
  已持久化结构化 API rejection
- **THEN** user-facing technical detail MUST 以 target Provider/API rejection 为主
- **AND** warning MUST NOT 覆盖该根因

### Requirement: Continuation Artifact Storage Paths MUST Use Platform-Safe Keys

Native Provider Continuation 的 artifact 存储 MUST 使用 platform-safe 的确定性路径
key，不得将 logical `sessionId`（含 `engine:` 前缀的组合串）直接作为 filesystem
path segment。record JSON 内 MUST 继续保存 caller 提供的原始 `sessionId`。读取
MUST 兼容 legacy `{sessionId}` 目录布局，确保升级前已落盘的 artifact 仍可被
`read_artifact` / `read_typed_artifact` 读取，且 `scan_orphan_artifacts` 不因路径
布局变化误删被引用 artifact。

#### Scenario: Windows prepares a continuation from a prefixed native session

- **WHEN** source `sessionId` 为 `claude:<nativeSessionId>` 或 `kimi:<nativeSessionId>`
- **THEN** artifact 写入 MUST 使用 platform-safe key 构造目录（不包含 `:` 等
  Windows 保留字符），不得产生 `os error 267` / `ERROR_DIRECTORY`
- **AND** record JSON 内的 `sessionId` MUST 保持原始 `claude:<nativeSessionId>` 值

#### Scenario: legacy artifact layout remains readable after upgrade

- **WHEN** 磁盘上已存在
  `shared-context-artifacts/{workspace_hash}/{sessionId}/<artifact>.json` 旧布局
- **THEN** `read_artifact` / `read_typed_artifact` MUST 在新 key 路径未命中时
  fallback 读取 legacy 路径
- **AND** 被引用 artifact MUST NOT 被 `scan_orphan_artifacts` 清退

#### Scenario: unsafe segment values are rejected at the store boundary

- **WHEN** 任一 bare path segment（如 `artifact_id`）包含 Windows 保留字符
  `\ / < > : " | ? *`、控制字符、尾随点/空格或保留设备名（`CON` 等）
- **THEN** artifact store MUST fail closed，返回 invalid segment 错误，禁止将其
  写入路径

### Requirement: Codex Continuation Target Identity MUST Match The Catalog

Codex Provider Continuation MUST 使用 `thread/start` 返回的 raw thread id 作为 runtime、
operation result、catalog metadata 与 frontend selection 的同一 authoritative identity。
Recovery MAY 读取旧 `codex:<thread-id>` operation result，但新 target MUST NOT 再写入 prefixed
result 或 duplicated stable key。

#### Scenario: Codex continuation becomes ready

- **WHEN** `thread/start` 返回 raw `<thread-id>` 且 context delivery 成功
- **THEN** operation `resultSessionId` MUST 等于 `<thread-id>`
- **AND** Provider Binding 与 Continuation metadata MUST 覆盖同一个 raw catalog row
- **AND** frontend MUST reload 并选择该 raw row

#### Scenario: legacy prefixed operation is reopened or recovered

- **WHEN** ready/recovery path 读取到既有 `resultSessionId=codex:<thread-id>`
- **THEN** runtime command MUST 继续使用 raw `<thread-id>`
- **AND** returned operation MUST 将 result 规范化为 raw `<thread-id>`
- **AND** recovery MUST NOT 创建第二个 target

### Requirement: Codex Structured Import MUST Use A Closed Control Envelope

Codex `thread/inject_items` history import MUST 在 imported items 首尾写入 exact
`MOSSX_CONTEXT_PACKAGE` 与 matching `MOSSX_CONTEXT_ACCEPTED` marker。Presentation MUST 隐藏
完整 envelope，包括其中任意 user、assistant、developer、reasoning 或 lifecycle item；envelope
关闭后的普通对话 MUST 正常显示。

#### Scenario: imported history contains user and developer items

- **WHEN** structured import payload 包含 environment、instructions 或历史 user messages
- **THEN** 所有 payload MUST 位于 matching package/accepted envelope 内
- **AND** Canvas MUST NOT 把它们渲染为普通聊天

#### Scenario: continuation imports an earlier continuation

- **WHEN** imported history 自身包含完整 package/accepted envelope
- **THEN** presentation classifier MUST 使用 identity-aware nested boundary 处理
- **AND** outer envelope 关闭前 MUST NOT 泄露 inner 或 remaining imported items

#### Scenario: imported legacy history contains an unmatched package marker

- **WHEN** outer envelope 内存在旧版本遗留的 package marker 且没有 matching accepted
- **THEN** outer matching accepted MUST 同时关闭该 imported legacy marker
- **AND** outer envelope 后的普通 user message MUST 正常显示

#### Scenario: user sends after continuation is ready

- **WHEN** matching accepted marker 已关闭 control envelope，随后用户发送普通消息
- **THEN** 普通 user message 与对应 assistant output MUST 正常显示
- **AND** filtering MUST NOT 进入 streaming reducer hot path

### Requirement: Codex Continuation Canvas MUST Hide Host Bootstrap

Canvas presentation MUST 依据 authoritative `provider-continuation` origin 与 Codex engine
隐藏 app-server 在 MossX control boundary 前后生成的 host bootstrap。该行为 MUST NOT 通过
全局 substring 删除实现，MUST NOT 改写 vendor history，并 MUST 在第一条真实 user turn 开始
后恢复普通展示。

#### Scenario: Codex injects environment context before the control prompt

- **WHEN** Codex Provider Continuation history 以 `environment_context` 开始，随后出现 exact
  MossX continuation control prompt 与 bootstrap assistant output
- **THEN** Canvas MUST 隐藏整个 leading host/control exchange
- **AND** Continuation Context Card MUST 继续作为 timeline leading metadata 展示

#### Scenario: the first real user turn arrives

- **WHEN** leading host/control exchange 后出现第一条普通 user message
- **THEN** 该 user message 与后续 assistant output MUST 正常显示
- **AND** trailing streaming cache MUST NOT 恢复已隐藏的 bootstrap item

#### Scenario: an ordinary Codex session contains similar text

- **WHEN** catalog row 不是 `provider-continuation`，或 active engine 不是 Codex
- **THEN** Messages MUST NOT 启用 leading bootstrap suppression
- **AND** 用户讨论 `environment_context` 或 MossX protocol 的普通正文 MUST 保持既有语义

### Requirement: Ready Target Selection MUST Observe Authoritative Catalog Metadata

Frontend MUST await the existing workspace catalog refresh after Provider Continuation becomes
ready and before selecting the target. It MUST NOT add polling、fixed delay、provisional Session
state or a second continuation identity registry.

#### Scenario: target history is available before catalog refresh settles

- **WHEN** runtime 已返回 ready，但 workspace catalog refresh Promise 尚未 settle
- **THEN** frontend MUST keep the current source/Dialog surface and MUST NOT select target
- **AND** target history MUST NOT enter Canvas with ordinary-session presentation

#### Scenario: catalog refresh settles with the continuation target

- **WHEN** workspace catalog refresh 已发布包含 target metadata 的 authoritative snapshot
- **THEN** frontend MUST close the Dialog and select the exact raw target id
- **AND** target Canvas 首帧 MUST 同时获得 Codex engine 与 `provider-continuation` origin

### Requirement: Provider Continuation Source Identity MUST Be Engine-Aware

Provider Continuation MUST 在读取来源 history 前验证 logical session identity 与 native session identity 的 Engine-specific 对应关系。Codex source MUST 接受 exact raw native thread id 或 `codex:` prefixed logical id；Claude 与 Kimi source MUST 继续使用各自的 prefixed logical id。Validator MUST 保留 caller 提供的合法 logical id，不得为通过校验而重写 lineage identity。

#### Scenario: raw Codex catalog identity is continued

- **WHEN** Codex source 的 `sessionId` 与 `nativeSessionId` 都是同一个 non-empty raw thread id
- **THEN** continuation preparation MUST 接受该 source identity
- **AND** materialization 与 lineage MUST 保留该 raw `sessionId`

#### Scenario: canonical Codex identity remains compatible

- **WHEN** Codex source 的 `sessionId` 为 `codex:<thread-id>` 且 `nativeSessionId` 为对应的 `<thread-id>`
- **THEN** continuation preparation MUST 接受该 source identity
- **AND** MUST NOT 去除 caller 提供的 canonical prefix

#### Scenario: Codex logical and native identities disagree

- **WHEN** Codex source 的 raw 或 prefixed `sessionId` 未映射到同一个 `nativeSessionId`
- **THEN** continuation MUST 在读取 source history 或创建 target side effect 前 fail closed
- **AND** MUST 返回 source identity mismatch diagnostic

#### Scenario: non-Codex source omits its Engine prefix

- **WHEN** Claude 或 Kimi source 的 `sessionId` 仅等于 raw `nativeSessionId`
- **THEN** continuation MUST 拒绝该 source identity
- **AND** canonical `<engine>:<nativeSessionId>` source MUST 保持可用

### Requirement: Native Continuation MUST Export The Effective History Window

Native Provider Continuation MUST materialize the effective vendor history at the frozen cursor.
For Codex rollout history, a valid persisted compaction replacement MUST supersede entries from
older windows; entries appended after that compaction MUST remain eligible for export. The reader
MUST NOT modify the source history.

#### Scenario: Codex rollout contains multiple compactions

- **WHEN** a frozen Codex rollout contains one or more valid `compacted` records
- **THEN** the reader MUST use the last valid `replacement_history` as the effective base
- **AND** MUST append portable records after that compaction
- **AND** MUST NOT export entries that only belong to superseded windows

#### Scenario: compaction replacement contains private state

- **WHEN** effective replacement history contains encrypted, reasoning, signature, or unknown blocks
- **THEN** the reader MUST apply the existing private/unknown omission policy
- **AND** MUST NOT expose private state to the destination Provider

### Requirement: Native Continuation Package Budget MUST Be Transport Independent

The Context Package compiler MUST apply the configured estimated-token budget to the final portable
delta independently of whether delivery uses prompt transport or structured native history import.
Structured import capability MUST NOT be treated as unlimited context capacity.

#### Scenario: Codex structured import source exceeds budget

- **WHEN** `thread/inject_items` is supported and the effective portable history exceeds the package budget
- **THEN** the compiler MUST retain `native-history-import` as the transport mode
- **AND** MUST fold and trim the imported delta to the same configured budget
- **AND** `packageEstimatedTokens` MUST describe the budgeted delta

#### Scenario: source fits within budget

- **WHEN** effective portable history is within the configured package budget
- **THEN** the compiler MUST preserve the existing capability-selected transport
- **AND** MUST NOT introduce checkpoint omissions solely because another transport is available

### Requirement: Native Continuation Checkpoint MUST Preserve A Non-Empty Portable Spine

Checkpoint projection MUST deterministically bound oversized text and atomic Tool Exchange content.
If portable source entries exist, the compiler MUST preserve at least the latest User intent and the
latest Assistant result when available. It MUST NOT return an executable package whose estimated
Token count is zero, and it MUST fail closed if a non-empty in-budget package cannot be produced.

#### Scenario: a single Turn contains oversized Tool output

- **WHEN** the only or latest complete Turn exceeds budget because Tool Call/Result output is large
- **THEN** the compiler MUST keep each retained Tool Call/Result pair atomic
- **AND** MUST fold arguments and output using deterministic bounded evidence
- **AND** MUST preserve the User intent and latest Assistant result
- **AND** `packageEstimatedTokens` MUST be greater than zero and no greater than budget

#### Scenario: older complete Turns exceed budget

- **WHEN** multiple complete Turns exceed budget after deterministic folding
- **THEN** the compiler MUST remove oldest complete Turns first
- **AND** MUST retain a non-empty latest portable Turn
- **AND** MUST record each fold or removal in projection omissions

### Requirement: Provider Continuation Token Preview MUST Describe Projection Estimates

The Provider Continuation preview MUST describe source and package estimates as portable-history and
continuation-package estimates. It MUST NOT present deterministic character estimates as exact
Provider context usage or billing tokens.

#### Scenario: preview displays source and package estimates

- **WHEN** preparation returns `sourceEstimatedTokens` and `packageEstimatedTokens`
- **THEN** the dialog MUST label the values as portable history to continuation package
- **AND** MUST preserve the source-to-package direction
- **AND** MUST NOT claim the values are exact model tokenizer output

### Requirement: Provider Continuation Dialog MUST Remain Dismissible During Target Delivery

Provider Continuation product Dialog MUST 允许用户在 target delivery / verification（frontend `running` stage）期间取消或关闭。取消 MUST 立即关闭 Dialog，MUST NOT 修改来源 Session 内容、Provider binding 或当前用户选中的线程。取消 MUST NOT 要求 backend hard-abort；in-flight create 可继续完成，但 Frontend MUST 将本次 operation 标记为 canceled，使 late success 不得接管 UI。

#### Scenario: user cancels while delivering context

- **WHEN** Dialog 处于 `running` 且 progress 显示传递或校验上下文
- **THEN** 底部取消控件 MUST 保持可交互
- **AND** 用户点击取消后 Dialog MUST 立即关闭
- **AND** 来源 Session 与当前选中线程 MUST 保持不变

#### Scenario: late create success after cancel is ignored

- **WHEN** 用户已在 `running` 中取消同一 `operationId`
- **AND** 随后 `createNativeProviderContinuation` 以 `ready` 与 result Session 返回
- **THEN** Frontend MUST NOT 自动选中该 result Session
- **AND** MUST NOT 为 destination 写入/激活 active Provider 记忆
- **AND** MUST NOT 重新打开该 Dialog

#### Scenario: late create failure after cancel is silent

- **WHEN** 用户已在 `running` 中取消同一 `operationId`
- **AND** 随后 create 失败或进入 recovery-required
- **THEN** Frontend MUST NOT 用该失败重新打开 Dialog
- **AND** 来源 Session MUST 保持不变

#### Scenario: cancel during preparing still discards prepared-only operation

- **WHEN** 用户在 prepare-only preview 完成前或 confirm 前取消
- **THEN** 系统 MUST 继续仅 discard phase=`prepared` 且无 result identity 的 operation
- **AND** MUST NOT 删除已进入 `creating`、`ready` 或 `recovery-required` 的 operation

### Requirement: Provider Continuation Preview MUST Be Side-Effect-Bounded

系统 MUST 提供 idempotent prepare-only preview，在 target side effect 前冻结 artifacts 并返回 fidelity 与 token estimate。取消 preview MUST 丢弃匹配 request 的 prepared operation；共享 content-addressed artifact cache MAY 保留，但 MUST NOT 创建 target Session、发送 Context、修改 source history 或写 target catalog identity。

#### Scenario: preview returns decision metrics without target mutation

- **WHEN** 用户选择可用 destination Provider Profile
- **THEN** 系统 MUST 冻结并编译同一 operation 的 Context Package
- **AND** MUST 返回 source/package estimated tokens 与 fidelity
- **AND** MUST NOT 创建 target Native Session 或发送 Context

#### Scenario: canceled preview is discarded safely

- **WHEN** 用户在 prepare-only preview 后取消，或在异步 preview 完成前关闭 Dialog
- **THEN** 系统 MUST 只删除 checksum 匹配、phase 为 `prepared` 且无 result identity 的 operation
- **AND** MUST NOT 删除或修改已进入 `creating`、`ready` 或 `recovery-required` 的 operation

#### Scenario: confirmed execution reuses preview artifacts

- **WHEN** 用户确认已经 prepared 的 preview
- **THEN** execution MUST 复用同一 operation id、artifact refs 与 checksums
- **AND** MUST NOT 因 source history 后续增长而重新编译不同 Context

### Requirement: Provider Continuation Progress MUST Reflect Real Stages

Provider Continuation MUST 以 operation-scoped、低频 stage milestones 暴露 preparation、target delivery、verification 与 completion progress。Frontend MUST NOT 用 timer、polling 或 elapsed-time interpolation 伪造进度。

#### Scenario: local continuation reports stage progress

- **WHEN** prepare 或 execute 跨越实际 processing boundary
- **THEN** backend MUST emit 包含 workspace id、operation id、phase 与 phase percentage 的 progress event
- **AND** Dialog MUST 只消费当前 operation 的 event

#### Scenario: provider latency stalls one stage

- **WHEN** target Provider/API 长时间停留在 context delivery
- **THEN** progress MUST 保持在对应真实阶段
- **AND** MUST NOT 随 elapsed time 自动增长到 completion

### Requirement: Claude Continuation Bootstrap MUST Use A Minimal CLI Surface

Claude Provider Continuation bootstrap MUST 使用 continuation-only minimal command surface，禁用不参与 Context import 的 tools、skills、MCP、hooks、agents、auto-memory、thinking 与 prompt suggestions。普通 Claude turn MUST 保持现有 command surface。Minimal bootstrap MUST 保留 Provider auth/routing、model、stable target session identity、durable delivery evidence 与 explicit Provider/API rejection detection。

#### Scenario: continuation starts Claude target

- **WHEN** Claude target 执行 Context Package bootstrap
- **THEN** command MUST 启用 safe customization boundary、empty tools、disabled slash commands、disabled thinking 与 disabled prompt suggestions
- **AND** MUST 跳过 curated skill 与 AskUser MCP injection

#### Scenario: ordinary Claude turn starts

- **WHEN** 普通非-continuation Claude message 启动
- **THEN** minimal bootstrap flag MUST 默认为 false
- **AND** existing tools、skills、MCP、hooks 与 permission behavior MUST 保持不变

#### Scenario: target provider rejects bootstrap

- **WHEN** minimal bootstrap 后 target history 记录 structured Provider/API rejection
- **THEN** operation MUST 进入 existing `target-provider-rejected` recovery path
- **AND** MUST NOT 因 user-entry persistence 或 progress completion 进入 `ready`

### Requirement: Provider Continuation MUST Confirm Destination Engine Before Hydration

Provider Continuation MUST confirm the destination `EngineType` as the native runtime authority before persisting destination Composer state or selecting the target thread. A failed confirmation MUST leave the source session active and MUST NOT navigate to a target whose Composer would be attributed to the source engine.

#### Scenario: continuation changes a non-Codex source to Codex

- **WHEN** a ready continuation returns a Codex destination
- **THEN** the frontend MUST confirm native Codex, persist the exact target model/effort, and select the target thread
- **AND** the Composer MUST display Codex-owned engine/model state on the first target render

#### Scenario: destination engine confirmation fails

- **WHEN** native engine confirmation returns failure
- **THEN** the continuation MUST remain on the existing error/recovery surface
- **AND** no target thread navigation or second-provider operation MUST be started
