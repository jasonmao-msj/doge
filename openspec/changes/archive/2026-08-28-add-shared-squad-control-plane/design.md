## Context

Shared Session 已有四个可复用基础：

1. `SharedEventWriter` 是 SQLite WAL 的唯一写 authority。
2. `CanonicalFact` 与 `TurnExecutionSnapshot` 提供 durable intent、immutable target 与 deterministic replay。
3. `SharedRuntimeCoordinator` 以 exact owner 处理 observation/terminal settlement。
4. `shared_projection` 把 canonical history 投影为 Conversation presentation。

缺口不是“再调用几个 CLI”，而是 durable orchestration control plane。V1 必须全新设计，不引用已删除的 Task Center/Project Map/task store，也不能用自由文本日志代替状态机。

## Goals / Non-Goals

**Goals:**

- Agent-generated plan 与 mossx-owned execution authority 分离。
- Dynamic DAG、预算、exact Lead target、permission envelope 在一次用户确认后 seal。
- 所有状态可从 Canonical Log deterministic rebuild。
- Worker turns 与普通 Conversation presentation 隔离，最终 synthesis 才成为 top-level answer。

**Non-Goals:**

- Agent mesh、自由消息总线、跨 workspace 自动执行。
- engine-native subagent normalization。
- Worktree Executor、multi-writer merge、public Plugin/Pipeline API。

## Decisions

### 1. Hybrid Control Plane

Lead Agent 输出 `SquadPlanProposalV1`，mossx 只接受经过 shared model structured-output normalization 与 pure domain validator 校验的 object。业务状态机不读取 assistant prose。

```text
Composer Squad send
  -> runRequested fact
  -> Lead ordinary turn
  -> normalize + validate proposal
  -> planProposed fact
  -> user edits/approves once
  -> planApproved fact (sealed approval envelope)
  -> scheduler starts
```

Alternatives:

- Pure Agent orchestration：实现快，但 crash/retry/permission 无法证明，拒绝。
- Fully deterministic planner：可验证，但对开放式代码任务分解能力不足，拒绝。

### 2. Typed Canonical Facts

在 `CanonicalFact` 增加独立 variants，而不是继续扩张 `ControlFact.details`：

- `SquadRunRequested`
- `SquadPlanProposed`
- `SquadPlanApproved`
- `SquadPlanRevised`
- `SquadNodeDispatchPrepared`
- `SquadNodeAttemptLinked`
- `SquadNodeOutcomeRecorded`
- `SquadVerificationRecorded`
- `SquadMutationLeaseChanged`
- `SquadBranchBlocked`
- `SquadCancelRequested`
- `SquadRunSettled`

Canonical event 继续使用现有 event schema version；Squad fact 以 `factId`、`runId` 与各自 timestamp 字段形成 durable identity，node facts 再带 `nodeId`、`attemptId`。`SquadPlanProposalV1`、`SquadTypedOutcomeEnvelopeV1` 与 `SquadProjectionV1` 自带 `schemaVersion = 1`。`fact_type` 使用稳定 dot identifier，event id 与 idempotency key 仍由 writer 统一计算。

Alternative：一个 `SquadEvent { kind, payload: Value }`。它减少 enum 代码，但把 schema drift 推迟到 runtime，拒绝。

### 3. Domain Model and State Machine

```text
SquadRun
  Requested -> Planning -> AwaitingApproval
  AwaitingApproval -> Running | Cancelled
  Running -> Succeeded | Failed | Blocked | Cancelled
```

```text
SquadNode
  Pending -> Ready -> DispatchPrepared -> Running
  Running -> Succeeded | Failed | Blocked | Cancelled
  Failed(verification) -> Ready(repair attempt), if sealed budget remains
```

`SquadPlanProposalV1` fields:

- `summary`
- `budget { maxParallelReadOnly, maxNodeAttempts, maxRepairAttempts, maxWallClockSeconds }`
- `nodes[] { id, title, kind, goal, dependsOn, repairOf?, target, permission, maxAttempts, successCriteria }`
- `finalNodeId`

Approval envelope 不另建第二份可漂移 DTO：`SquadRunRequested` 封存 `workspaceId + canonical workspaceRoot + leadTarget`，approved plan 封存 budget。V1 每个 node target 必须与 Lead target exact equal；permission 由 node kind 固定。Plan validator 保证 stable unique ids、DAG acyclic、dependencies exist、single final synthesis、final transitive reachability、budget ceiling、downstream Verify、target/permission 不扩权。

### 4. One Active Run Per Shared Session

writer 在 append `SquadRunRequested` 时检查同 session unresolved run。存在 active run 时返回 stable conflict，不创建第二 run。历史 run 可无限保留。

这一约束是 V1 产品简化，不是全局 scheduler 限制；不同 Shared Sessions 可各自运行，最终由 workspace mutation lease 管 mutation concurrency。

### 5. Dedicated SquadProjection

新增 pure projector：输入 canonical events，输出 `SquadProjectionV1`。它不写 runtime state；checkpoint 只是可删除 cache。

```text
Canonical Log
  + ordinary Turn facts ---------> Shared Conversation Projection
  + Squad facts + linked attempts -> Squad Projection
```

带 `squadWorkerBindingKey` 的 Worker `attemptId` 永远标记为 nested-only。Shared Conversation projector 跳过其 user/assistant/usage rows；Squad inspector 从 `SquadProjectionV1` 读取 node summary/artifacts。`SquadRunRequested` 投影 top-level user request；只有 `SquadRunSettled(status=succeeded)` 才投影唯一 top-level assistant final。该边界使 full rebuild 与 checkpoint incremental replay 等价，Synthesize raw turn 永不直接泄漏。

### 6. Command Boundary

Tauri command 只做 mapping + authority lookup：

- `shared_squad_request_run`
- `shared_squad_record_lead_plan`
- `shared_squad_revise_plan`
- `shared_squad_approve_plan`
- `shared_squad_get`
- `shared_squad_claim_ready_nodes`
- `shared_squad_record_attempt_outcome`
- `shared_squad_cancel`
- `shared_squad_finalize_cancel`

核心函数只依赖 `SharedEventWriter` 与 explicit request DTO，便于 Rust integration tests。Frontend production code 只经 `src/services/tauri/squadOrchestration.ts` 调用。

## Risks / Trade-offs

- [CanonicalFact enum 墉大，writer match 容易漏分支] → exhaustive match + fact-type mapping tests + runtime-contract gate。
- [Plan proposal 由 model 生成，schema 可能漂移] → shared normalizer、domain validator、最多一次 repair、失败不持久化 trusted plan。
- [Worker turns 被隐藏后诊断困难] → raw transcript/artifact 保留在 node detail，不进入 top-level timeline。
- [一个 active run 限制高级用户] → V1 明确 ceiling；未来提升并发只改 session run admission，不改 event model。

## Migration Plan

1. Additive canonical variants 与 schema version；旧 events 读取不变。
2. V1 默认开启；frontend `VITE_CCGUI_SQUAD_ORCHESTRATION_V1` / local override 与 backend `CCGUI_SQUAD_ORCHESTRATION_V1` 可独立 fail closed。
3. 关闭 flag 时禁止新 run，既有 Squad facts/projection 仍可读。
4. Rollback 只需关闭 flag/移除 UI entry；不删除 canonical data。

## Open Questions

无。V1 decisions 已由用户确认；Phase 6 再定义 public Plugin/Pipeline exposure。
