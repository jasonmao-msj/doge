## ADDED Requirements

### Requirement: Gate-ready MUST progressively hydrate visible non-active workspace first-paint lists

当 active workspace 的 first-paint 已完成并允许进入 interactive window 后，客户端 MUST 对 connected、未折叠且尚未 UI hydrated 的非 active workspace 按 idle 顺序执行 `first-paint` hydration。该 background queue MUST NOT 自动升级为 `full-catalog`，并 MUST reuse existing orchestrator dedupe/stale/`thread-session-scan` concurrency controls。

#### Scenario: sibling workspace becomes visible without a click

- **WHEN** active workspace first-paint completes
- **AND** sibling workspace is connected, visible, and has no cached thread list
- **THEN** sibling workspace MUST eventually receive one `thread-list:first-paint:<workspaceId>` task
- **AND** Sidebar MUST stop showing an indefinite loading state after that task settles

#### Scenario: background hydration remains bounded and ordered

- **WHEN** multiple eligible sibling workspaces exist
- **THEN** the queue MUST schedule at most one pending background workspace at a time
- **AND** each target MUST use `first-paint` rather than automatic `full-catalog`

#### Scenario: cold-start and excluded workspaces remain protected

- **WHEN** active first-paint has not completed, or a workspace is collapsed/disconnected/already hydrated
- **THEN** that workspace MUST NOT be automatically hydrated by this queue
