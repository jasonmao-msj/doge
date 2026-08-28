## ADDED Requirements

### Requirement: Binding MUST track native context trust

Each Shared binding MUST expose a durable native context trust state of `trusted` or `dirty`. Missing legacy fields MUST be interpreted with a documented compatibility rule: ready native identity defaults to `trusted`; missing native identity defaults to `dirty`.

#### Scenario: new binding without native is dirty

- **WHEN** a binding has no `native_session_id`
- **THEN** native context trust MUST be treated as `dirty`

#### Scenario: legacy ready native defaults to trusted

- **WHEN** a binding has a native session id and availability ready
- **AND** `nativeContextTrust` is absent from provisioning metadata
- **THEN** trust MAY be treated as `trusted` for compatibility

### Requirement: Failure signals MUST mark trust dirty

The system MUST set native context trust to `dirty` when the binding experiences terminal delivery/run failure that invalidates reliance on native-held history, including provider rejection / failed outcome, native-session-not-found, recovery-required provisioning, explicit rebuild, and abandon of unresolved attempts that leave native identity ambiguous.

#### Scenario: failed turn after accept dirties trust

- **WHEN** a turn reached context acceptance on a binding
- **AND** the turn later commits with failed / provider-rejected outcome
- **THEN** that binding's native context trust MUST be `dirty` before the next prepare_delivery

#### Scenario: rebuild dirties and clears native identity

- **WHEN** the user rebuilds a binding
- **THEN** native session identity MUST be cleared
- **AND** trust MUST be `dirty`

### Requirement: Dirty with needs-history MUST rematerialize even if incremental package is non-empty

When binding trust is `dirty` and the session needs history, prepare_delivery MUST rematerialize by compiling from the start of the session without destination-owned omission, **even if** the incremental package is non-empty (for example only short “continue” user turns after the accepted cursor).

#### Scenario: continue-only non-zero package still rematerializes original task

- **WHEN** the Shared event log contains an earlier user task body before the accepted cursor
- **AND** later failed turns left only short continue `turnRequested` facts after the cursor (not destination-owned)
- **AND** binding trust is `dirty`
- **THEN** prepare_delivery MUST rematerialize so prompt-prefix or delta includes the original task body
- **OR** MUST fail closed with a primary `empty-context-handoff:` error if rematerialize remains empty

#### Scenario: trusted healthy continue keeps no full rematerialize

- **WHEN** binding trust is `trusted`
- **AND** the incremental package is zero-transfer because history is treated as destination-owned / already accepted
- **AND** needs-history is true
- **THEN** prepare_delivery MUST NOT force rematerialize solely due to zero-transfer
- **AND** the system MAY record `no-context-transfer-required` and send only the user text

#### Scenario: missing trust field defaults dirty

- **WHEN** binding provisioning metadata lacks `nativeContextTrust`
- **THEN** trust MUST be treated as `dirty` (fail-closed)

### Requirement: Successful rematerialized acceptance restores trust

After a non-zero-transfer package is accepted for a binding, or after a zero-transfer turn completes successfully while resumed against native identity, the system MUST set trust back to `trusted`.

#### Scenario: rematerialized accept clears dirty

- **WHEN** prepare_delivery rematerialized a non-empty package
- **AND** context delivery is accepted for that package
- **THEN** binding trust MUST become `trusted`

### Requirement: Empty handoff after failed rematerialize is typed

If needs-history is true and both incremental and rematerialized packages are zero-transfer, prepare_delivery MUST return an error prefixed with `empty-context-handoff:` and MUST NOT label evidence as `no-context-transfer-required`.

#### Scenario: empty-context-handoff blocks dishonest no-transfer evidence

- **WHEN** rematerialize cannot produce transferable history despite needs-history
- **THEN** the error MUST use the `empty-context-handoff:` prefix
- **AND** Runtime user delivery for that attempt MUST NOT proceed as a normal accepted zero-transfer send
