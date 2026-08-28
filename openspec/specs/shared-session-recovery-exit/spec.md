# shared-session-recovery-exit Specification

## Purpose

定义 Shared Session recovery exit ladder 的 durable recovery、abandon 与 actionable UI contract。

## Requirements

### Requirement: Recovery UI Actions MUST Match Disposition

The recovery status bar MUST present Auto-handle and Skip-turn as the simplified default surface, with Probe / Stop / Rebuild available as advanced actions or Auto-handle steps. Stop and Abandon MUST remain reachable and Stop MUST NOT be enabled without an interruptible in-flight attempt.

#### Scenario: interrupt capability missing

- **WHEN** the engine cannot interrupt the owned attempt
- **THEN** the UI MUST NOT pretend Stop succeeded
- **AND** Skip-turn MUST remain the primary explicit exit with a clear confirmation

### Requirement: Recovery Confirmations MUST Be Application Dialogs

Any confirmation required before durable Abandon / Skip-turn MUST use an in-app dialog component.

#### Scenario: abandon path without window.confirm

- **WHEN** the user initiates Skip-turn / Abandon from the recovery bar
- **THEN** confirmation MUST be rendered by the application UI toolkit
- **AND** canceling the dialog MUST NOT invoke abandon
