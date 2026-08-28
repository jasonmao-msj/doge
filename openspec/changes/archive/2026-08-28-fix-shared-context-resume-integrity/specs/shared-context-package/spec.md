## ADDED Requirements

### Requirement: Zero-transfer packages MUST be distinguishable in audit

A Context Package with empty `prompt_prefix` and empty `delta` MUST remain a valid package shape, but delivery orchestration MUST treat it as zero-transfer and MUST NOT imply that Shared history was delivered.

#### Scenario: zero-transfer package id still deterministic

- **WHEN** the same empty source range and destination inputs compile twice
- **THEN** package identity MAY still be deterministic
- **AND** delivery MUST still apply empty-handoff rules based on transfer payload emptiness, not package id alone

### Requirement: Rematerialized packages MUST change identity when projection inputs change

When rematerialization changes `from_sequence_exclusive` and/or clears destination native identity for projection, the resulting package id MUST differ from the incremental empty package id so artifact storage and acceptance do not collide with the rejected empty handoff.

#### Scenario: rematerialize gets new package id

- **WHEN** an incremental compile yields zero-transfer package A
- **AND** rematerialize compile includes full history as package B
- **THEN** package B id MUST differ from package A id
- **AND** deliveryPrepared MUST reference package B
