## MODIFIED Requirements

### Requirement: Unavailable Target Blocks Send Without Rerouting

The V2 send path MUST block with a `target-unavailable` state when the selected provider/model/runtime is explicitly unavailable and there is no unresolved ambiguous attempt requiring recovery. The system MUST NOT elevate pure target unavailability into whole-session `recovery-required`, MUST NOT reroute to another provider or default model, and MUST keep the target picker switchable.

#### Scenario: unavailable target blocks send without rerouting

- **WHEN** the selected provider is unavailable or the model is outside the provider catalog
- **AND** there is no unresolved ambiguous attempt for the shared session
- **THEN** the send MUST be blocked with a target-unavailable state
- **AND** the system MUST NOT enter recovery-required solely for that unavailability
- **AND** the system MUST NOT reroute to another provider or default model
- **AND** the user MUST be able to select another target and retry

#### Scenario: ambiguous ack still enters recovery-required

- **WHEN** begin/dispatch acceptance is ambiguous or an in-flight attempt lacks terminal evidence
- **THEN** the session MUST enter `recovery-required`
- **AND** the system MUST NOT unlock via silent idle without durable settlement

### Requirement: Explicit Rebuild Archives Old Binding With Stop Guard

When the user explicitly rebuilds a `recovery-required` binding, the old binding metadata MUST be archived and a new native session prepared while the shared session identity stays unchanged. Rebuild MUST refuse while Runtime still owns the unresolved attempt unless that ownership has been released (stop/interrupt or terminal settlement).

#### Scenario: explicit rebuild archives old binding

- **WHEN** the user explicitly rebuilds a `recovery-required` binding and Runtime does not own the attempt
- **THEN** the old binding metadata MUST be archived
- **AND** a new native session MUST be prepared while the shared session identity stays unchanged

#### Scenario: rebuild refused while runtime owns attempt

- **WHEN** the user requests rebuild and Runtime still owns the unresolved attempt
- **THEN** rebuild MUST fail closed with a recovery-active class error
- **AND** the binding MUST NOT be archived until ownership is released
