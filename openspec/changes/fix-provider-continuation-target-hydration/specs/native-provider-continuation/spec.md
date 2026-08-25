## MODIFIED Requirements

### Requirement: Composer Provider Selection MUST Reuse Provider Continuation

Native Composer 从其他 Provider Profile 选择 Model 时 MUST 复用产品内 Provider Continuation Dialog 与现有 idempotent continuation operation；目标 snapshot MUST 包含用户选择的 Model。Sidebar context menu 与 Composer MUST 共享 prepare-only preview、一次确认、progress 与 recovery contract。Continuation ready 后，frontend MUST 先以 exact destination thread identity hydrate destination engine/model/effort，再选择目标 thread；MUST NOT 使用 source active-session setter 补写目标状态。

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

#### Scenario: ready destination is hydrated before selection

- **WHEN** Provider Continuation reaches `ready` with an exact destination thread id and frozen target snapshot
- **THEN** frontend MUST await destination engine/model/effort hydration for that exact thread before selecting it
- **AND** target Composer first paint MUST reflect the destination target without requiring a second user selection

#### Scenario: target hydration does not mutate the source session

- **WHEN** the ready destination is not yet the active thread
- **THEN** hydration MUST write only the destination thread's Composer selection and explicit destination engine transition
- **AND** MUST NOT call source/current-thread model or effort setters to approximate target state

#### Scenario: same destination binding model change stays in place

- **WHEN** the ready Claude+Doge continuation is active and the user selects another model in the same engine/provider binding
- **THEN** the system MUST update that target thread's per-thread model selection
- **AND** MUST NOT create a second Claude → Claude Provider Continuation
