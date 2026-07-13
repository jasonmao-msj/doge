## ADDED Requirements

### Requirement: Composer Startup Selection Recovery MUST Have An Acyclic Update Trigger

AppShell composer selection recovery MUST NOT subscribe to a React cache state that the same recovery effect writes. Internal cache hydration MAY notify resolver consumers, but that notification MUST NOT re-trigger the same reload solely because its own cache write changed reference identity.

#### Scenario: persisted selection hydration converges without self-trigger
- **WHEN** startup reload hydrates a persisted thread selection into the in-memory cache
- **THEN** the cache MAY publish one logical state change
- **AND** that cache write MUST NOT by itself invoke another reload cycle

#### Scenario: equivalent cache value is a no-op
- **WHEN** startup recovery resolves a selection logically equal to the current cache entry
- **THEN** the system MUST reuse the previous cache state reference
- **AND** the system MUST NOT rewrite the persisted value

### Requirement: Readiness And Pending Finalization MUST Preserve Continuous Selection

When engine defaults become ready while a pending thread is being finalized, selection seed, migration and reload MUST converge in a deterministic order. The canonical thread MUST inherit the pending selection before its active selection is published.

#### Scenario: readiness and finalize occur in the same startup window
- **WHEN** `engineDefaultSelectionReady` changes from false to true for an active pending thread
- **AND** that pending identity finalizes to a matching canonical thread before startup settles
- **THEN** the canonical thread MUST resolve to the seeded pending selection
- **AND** the published active selection MUST NOT transiently become `null`
- **AND** AppShell MUST NOT throw React `Maximum update depth exceeded`

#### Scenario: StrictMode replays startup effects
- **WHEN** React StrictMode replays selection recovery effects during cold startup
- **THEN** selection storage writes MUST remain idempotent
- **AND** the hook MUST converge within a bounded number of renders

### Requirement: Production Render Diagnostics MUST Use Public Mutation APIs

The production render diagnostics controller MUST use React Scan's public configuration API for enable/disable mutations and MUST NOT directly assign non-public instrumentation signals during App bootstrap.

#### Scenario: persisted diagnostics flag enables React Scan
- **WHEN** startup diagnostics are enabled by the persisted application flag
- **THEN** the controller MUST enable instrumentation through `scan({ enabled: true })`
- **AND** the controller MUST NOT assign `ReactScanInternals.instrumentation.isPaused.value`
