## ADDED Requirements

### Requirement: Main AppShell startup SHALL be gated by account and engine readiness
main window startup orchestration MUST 在 account session、selected engine entitlement、managed vault binding 与 configuration readiness 被 authoritative prove 后才挂载 AppShell 和启动 managed engine runtime；gate UI 自身 SHALL 保持 first-paint critical path 最小化。

#### Scenario: Gate renders before AppShell
- **WHEN** main window cold start 且 readiness 尚未证明
- **THEN** startup SHALL 渲染轻量 account gate，并且不执行 AppShell workspace hydration、engine discovery 或 managed runtime prewarm

#### Scenario: Readiness becomes committed
- **WHEN** AccountRuntime 发布 committed ready snapshot
- **THEN** startup SHALL 只挂载一次 AppShell，并在挂载后按既有 phase orchestration 启动 workspace work

#### Scenario: Account event wakes the gate
- **WHEN** payment、session 或 managed access event 到达
- **THEN** gate SHALL coalesce authoritative refresh，且不得把每个 event 或 reconciliation tick 作为 AppShell root state update

#### Scenario: Detached window starts without readiness
- **WHEN** detached window route 在 main account readiness 不成立时启动
- **THEN** detached window SHALL fail closed 或等待已提交的 process-level ready state，不得自行绕过 account gate
