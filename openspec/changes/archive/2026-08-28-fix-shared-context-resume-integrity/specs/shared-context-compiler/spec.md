## ADDED Requirements

### Requirement: destination-owned omission REQUIRES resumable destination native identity

The compiler MUST omit entries as `destination-owned` only when a destination native session identity is supplied for the compile **and** that identity is being treated as resumable for ownership dedupe. When the caller withholds destination native identity for rematerialization, the compiler MUST include portable history that would otherwise be destination-owned.

#### Scenario: rematerialize compile includes previously owned history

- **WHEN** compile is invoked with `destination_native_session_id = null` for rematerialization
- **AND** historical attempts were previously associated with the same binding key
- **THEN** those entries MUST NOT be dropped solely as `destination-owned`
- **AND** the resulting package MUST be allowed to carry transferable prompt-prefix or delta content

#### Scenario: resumable destination still dedupes owned attempts

- **WHEN** compile is invoked with a destination native session identity for a resumable binding
- **AND** an entry's attempt is owned by that binding
- **THEN** the entry MAY be omitted as `destination-owned`
- **AND** the omission MUST remain auditable in the ProjectionManifest

### Requirement: Compiler helpers MUST support needs-history detection

The system MUST be able to determine whether a session range contains portable history that would produce a non-empty transfer payload when compiled from the beginning without destination-owned omission. This determination drives empty-handoff guards.

#### Scenario: needs-history true when original user task exists

- **WHEN** Canonical events include a prior user task body in the session
- **AND** a full rematerialize compile would include that body in prompt-prefix or delta
- **THEN** needs-history MUST be true for empty-handoff evaluation on later continue turns
