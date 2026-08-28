## MODIFIED Requirements

### Requirement: Task Center SHALL Expose An Independent Task-Run Surface

系统 MUST 提供独立于 Kanban 的 `Task Center` surface，用于展示 task runs 的当前状态与详情，并且这些
runs MUST 能从真实 Kanban execution lifecycle 中生成与更新。Kanban launch 创建 TaskRun 前 MUST 冻结
当前 task 的 exact execution target；新 run 的 engine MUST 满足 shipping execution policy，历史 legacy run
仍 MUST 可读。

#### Scenario: task center lists active and recoverable runs

- **WHEN** workspace 中存在 running、waiting_input、blocked、failed 或 completed task runs
- **THEN** Task Center SHALL 在独立 surface 中列出这些 runs
- **AND** 用户 SHALL 无需逐个打开会话线程才能判断当前执行态

#### Scenario: task center keeps planning and execution surfaces separate

- **WHEN** 用户查看 Kanban task 与 Task Center run
- **THEN** Kanban SHALL 继续承担 planning 语义
- **AND** Task Center SHALL 承担 execution / observation / recovery 语义

#### Scenario: kanban launch creates task center run

- **WHEN** 用户或系统通过 Kanban manual、scheduled 或 chained trigger 启动任务执行
- **THEN** 系统 SHALL 在任何 session/turn side effect 前解析并验证 exact execution target
- **AND** 系统 SHALL 创建对应 trigger 的 TaskRun
- **AND** TaskRun SHALL 绑定 task definition、workspace、engine、runtime model 与可用 thread id
- **AND** Product managed target SHALL retain its Provider profile through session creation and first send

#### Scenario: displayed executable engine can create a run

- **WHEN** Kanban catalog exposes a selectable engine permitted by shipping execution policy
- **THEN** TaskRun creation MUST accept that engine
- **AND** presentation MUST NOT expose an engine that the run coordinator rejects as unsupported

#### Scenario: legacy run remains readable

- **WHEN** persisted Task Center data contains an engine accepted by the older schema
- **THEN** loader MUST preserve the historical run even if new task creation no longer offers that engine
- **AND** recovery actions MUST still respect current execution policy

