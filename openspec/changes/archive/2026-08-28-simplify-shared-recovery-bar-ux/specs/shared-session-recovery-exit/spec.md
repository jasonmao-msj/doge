## MODIFIED Requirements

### Requirement: Recovery UI Actions MUST Match Disposition

The recovery status bar MUST present a simplified default surface when the exit ladder is enabled: primary Auto-handle and Skip-turn actions, with Probe / Stop / Rebuild available as advanced or as steps inside Auto-handle. Stop and Abandon capabilities MUST remain reachable; Abandon is presented as Skip-turn. Action enablement MUST still respect owner kind (attempt vs binding) and MUST NOT enable Stop when there is no interruptible in-flight attempt.

#### Scenario: default surface does not require four equal buttons

- **WHEN** disposition requires recovery and exit ladder is enabled
- **THEN** the default (collapsed) UI MUST NOT require the user to choose among four peer engineering buttons
- **AND** Auto-handle or Skip-turn MUST be sufficient to complete a normal exit path

#### Scenario: active disposition still supports stop before rebuild

- **WHEN** disposition is active (accepted and Runtime-owned)
- **THEN** Auto-handle MUST attempt stop before rebuild when needed
- **AND** advanced Stop / Rebuild controls MAY remain available after expand

#### Scenario: interrupt capability missing

- **WHEN** the engine cannot interrupt the owned attempt
- **THEN** the UI MUST NOT pretend Stop succeeded
- **AND** Skip-turn (durable abandon) MUST remain the primary explicit exit with a clear confirmation

## ADDED Requirements

### Requirement: Recovery confirmations MUST be application dialogs

Any confirmation required before durable Abandon / Skip-turn MUST use an in-app dialog component. The recovery UI MUST NOT call `window.confirm` or host-native blocking confirm APIs for this path.

#### Scenario: abandon path without window.confirm

- **WHEN** the user initiates Skip-turn / Abandon from the recovery bar
- **THEN** confirmation MUST be rendered by the application UI toolkit
- **AND** canceling the dialog MUST not invoke abandon
