# shared-recovery-bar-ux Specification

## Purpose

定义 Shared Send recovery-required 状态下的 compact recovery bar 与显式退出动作。

## Requirements

### Requirement: Recovery Bar Collapsed Layout MUST Be Single-Line

When Shared Send state is `recovery-required` and the simplified recovery bar UX is active, the collapsed status bar MUST render as a single horizontal row containing a short title, one-line ellipsized summary, a details control, Auto-handle, Skip-turn, and an expand control.

#### Scenario: collapsed row shows two primary actions

- **WHEN** the session enters `recovery-required` with exit ladder enabled
- **THEN** the user MUST see Auto-handle and Skip-turn actions without expanding
- **AND** Probe / Stop / Rebuild MUST NOT all be required on the collapsed row

### Requirement: Recovery Details And Confirmations MUST Use Application Dialogs

Recovery details and any confirmation before durable Abandon / Skip-turn MUST use an application-owned dialog. The recovery UI MUST NOT call `window.alert`, `window.confirm`, or host-native blocking confirm APIs.

#### Scenario: canceling skip leaves recovery locked

- **WHEN** the user dismisses the Skip-turn confirmation
- **THEN** no abandon RPC MUST be invoked
- **AND** the session MUST remain `recovery-required`

### Requirement: Auto-Handle MUST Run The Recovery Exit Ladder Without Abandon

Choosing Auto-handle MUST serially attempt owner resolution, recovery, interrupt, and rebuild as applicable. It MUST NOT durable-abandon the turn; failure MUST keep `recovery-required` and leave Skip-turn available.

#### Scenario: auto-handle rebuilds after recover unknown

- **WHEN** Auto-handle cannot settle via recover/interrupt alone and a binding key is available
- **THEN** it MUST attempt rebuild with best-effort stop when an attempt owner exists
- **AND** on rebuild success the session MUST become idle
