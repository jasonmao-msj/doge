## ADDED Requirements

### Requirement: Recovery bar collapsed layout MUST be single-line

When Shared Send state is `recovery-required` and the simplified recovery bar UX is active, the collapsed status bar MUST render as a single horizontal row containing: short title, one-line ellipsized summary, a details icon control, primary "auto-handle" action, primary "skip turn" action, and an expand control. Multi-line recovery copy MUST NOT be required on the collapsed row.

#### Scenario: collapsed row shows two primary actions

- **WHEN** the session enters `recovery-required` with exit ladder enabled
- **THEN** the user MUST see auto-handle and skip-turn actions without expanding
- **AND** Probe / Stop / Rebuild MUST NOT all be required on the collapsed row

### Requirement: Details MUST open an in-app dialog

The recovery details control MUST open an application-owned dialog (AlertDialog or equivalent) explaining why the session is locked and what the primary actions do. The system MUST NOT use `window.alert` for this content.

#### Scenario: open details dialog

- **WHEN** the user activates the details icon
- **THEN** an in-app dialog MUST appear with recovery explanation
- **AND** dismissing the dialog MUST leave the session still in recovery until an exit action succeeds

### Requirement: Auto-handle MUST run the recovery exit ladder without abandon

Choosing auto-handle MUST serially attempt owner resolution, recover attempt when applicable, interrupt when still runtime-owned, and rebuild binding when still locked. Auto-handle MUST NOT durable-abandon the turn. Success MUST unlock only via settling→idle or reattach running. Failure MUST keep `recovery-required` and leave skip-turn available.

#### Scenario: auto-handle clears empty owner

- **WHEN** auto-handle runs and there is no unresolved attempt and no recovery binding
- **THEN** the session MUST unlock through the standard settling path

#### Scenario: auto-handle rebuilds after recover unknown

- **WHEN** auto-handle cannot settle via recover/interrupt alone and a binding key is available
- **THEN** it MUST attempt rebuild (with best-effort stop when an attempt owner exists)
- **AND** on rebuild success the session MUST become idle

#### Scenario: auto-handle failure keeps skip available

- **WHEN** auto-handle ends without unlock
- **THEN** state MUST remain `recovery-required`
- **AND** skip-turn MUST remain actionable (subject to busy=false)

### Requirement: Skip turn MUST use in-app confirm then durable abandon

Choosing skip-turn MUST open an in-app confirmation dialog. The system MUST NOT use `window.confirm`. On confirm, the system MUST run durable abandon (or clear unlock for binding-only with no attempt) with the same fail-closed rules as recovery exit abandon.

#### Scenario: skip confirm cancel

- **WHEN** the user dismisses the skip confirmation without confirming
- **THEN** no abandon RPC MUST be invoked
- **AND** the session MUST remain `recovery-required`

#### Scenario: skip confirm success

- **WHEN** the user confirms skip for a unique unresolved attempt
- **THEN** durable abandon MUST run with force-stop semantics
- **AND** the session MUST unlock through settling→idle

### Requirement: Expanded advanced actions remain available

Expanding the bar MUST expose check-status (probe), stop (when stoppable), and rebuild/change-connection actions that map to the existing recovery RPCs. Stop MUST be disabled when there is no in-flight attempt owner.

#### Scenario: stop disabled without attempt

- **WHEN** expanded stop is shown and the current owner is not a single in-flight attempt
- **THEN** stop MUST be disabled
- **AND** the control MUST NOT pretend a stop succeeded
