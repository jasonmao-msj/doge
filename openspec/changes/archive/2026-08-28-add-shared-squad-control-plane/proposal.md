## Why

Shared Session 已具备 immutable `ExecutionTarget`、Canonical Fact、single-writer event log 与 exact-owner runtime routing，但还没有可恢复、可审计的多 Agent plan authority。Phase 5 需要在不制造第二条事实链的前提下，把一次对话内的复杂任务组织成 mossx 可验证的 Dynamic DAG。

## 目标与边界

- 仅在 Shared Session 内创建一个 active `SquadRun`，由当前 Composer target 启动 Lead planning。
- Agent 只提出 typed `SquadPlan`；mossx 负责 validation、persistence、state transition 与 dispatch authority。
- 所有 orchestration lifecycle 作为 typed Canonical Facts 写入现有 `SharedEventWriter`，由 rebuildable `SquadProjection` 读取。
- 用户只确认一次 plan；确认后自动执行，除 `Emergency Stop` 外不再插入人工 checkpoint。

## What Changes

- 新增 `SquadRun`、`SquadPlan`、`SquadNode`、`ApprovalEnvelope`、`NodeAttemptLink`、`TypedOutcomeEnvelope` 与 projection contract。
- 新增 plan schema validator：DAG acyclic、node/edge identity、target allowlist、预算、权限与 verifier read-only 约束必须在 side effect 前校验。
- 新增 typed orchestration facts；禁止把状态机压入自由格式 `ControlFact.details`。
- 新增 one-active-run-per-Shared-Session、plan revision before approval、plan seal after approval 的状态机。

## 非目标

- 不恢复已删除的 Task Center、Project Map 或旧 orchestration store。
- 不提供显式 slash command、自动意图识别、agent mesh 或自由 agent-to-agent chat。
- 不把 engine-native subagent 暴露为 first-class Squad node。
- 不在本 change 执行 Worker runtime、workspace mutation 或 UI。

## 方案取舍

- 采用 **Hybrid Control Plane**：Agent 产 plan，mossx 执行 typed validation/state machine。相比纯 Agent prompt orchestration，可恢复且权限边界可证明；相比完全硬编码 planner，保留模型分解复杂任务的能力。
- 采用 **same Canonical Log + dedicated projection**。相比独立 orchestration database，不产生第二事实源；相比复用 generic Control Fact，schema、幂等和 replay 更清晰。

## Capabilities

### New Capabilities

- `shared-squad-control-plane`: Shared Session 内 Squad plan、typed facts、state machine、validation 与 projection contract。

### Modified Capabilities

- `shared-event-storage`: Canonical event log 接受 typed orchestration facts，并保持 single-writer、idempotent 与 monotonic migration semantics。
- `shared-canonical-projection`: 普通 Conversation projection 必须隐藏 worker-only turns，Squad projection 可按 `attemptId` 重建 nested run state。

## Impact

- Backend: `src-tauri/src/shared_event_log/**`、新增 `src-tauri/src/squad_orchestration/**`。
- Frontend contract/service: `src/features/squad-orchestration/**`、`src/services/tauri/**`。
- Storage: additive SQLite schema/version changes，无破坏性迁移、无新 dependency。

## 验收标准

- Invalid/cyclic/over-budget/out-of-allowlist plan 在任何 runtime side effect 前 fail closed。
- 同一 approved plan replay 任意次数得到同一 `SquadProjection`，duplicate fact 不产生重复 node transition。
- 普通 Shared Conversation projection 不显示 worker turns；最终 synthesis 仍能成为 top-level answer。
- 现有 Native/Shared send、canonical rebuild 与 legacy dual-read tests 保持通过。
