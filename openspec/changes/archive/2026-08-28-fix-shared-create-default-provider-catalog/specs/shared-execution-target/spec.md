## MODIFIED Requirements

### Requirement: New Shared Session MUST Start With A Complete Execution Target

A newly created Shared Session MUST persist a complete resolved `initialTarget` before it becomes
visible. The target MUST include Engine, Provider semantics, `modelCatalogEntryId`, runtime
`model`, and a readable Provider snapshot. `selectedEngine` MAY remain as a legacy rollback
mirror, but MUST be derived from `initialTarget.engine`; it MUST NOT be an independent creation
authority. Legacy partial metadata MAY remain readable, but MUST NOT define the creation contract
for new sessions.

Create-time model rows for `initialTarget` MUST come from the **provider-scoped authoritative
catalog** of the default create Provider (first ordered profile for the selected engine). The
system MUST NOT build `initialTarget.model*` from a bare `get_engine_models(engine)` / non-force-
refreshed engine status cache while labeling the snapshot as local/default.

#### Scenario: complete initial target is persisted atomically

- **WHEN** a user creates a Shared Session with a resolved local or managed Target
- **THEN** the first persisted legacy metadata and `shared_sessions_v2.selected_target_json` row
  MUST contain that complete Target
- **AND** the returned Session and Composer MUST expose the same Engine, Provider, catalog model,
  runtime model, and readable snapshot
- **AND** no Runtime Binding or canonical Turn fact may be created by Session creation

#### Scenario: missing or partial initial target fails before creation

- **WHEN** a caller omits `initialTarget` or supplies only Engine/Provider without the required
  catalog/runtime model pair and readable Provider snapshot
- **THEN** Session creation MUST fail with an actionable invalid-target error
- **AND** no Shared Session directory, metadata row, Binding, or Turn fact may be created

#### Scenario: selected engine conflicts with initial target

- **WHEN** a compatibility caller supplies `selectedEngine` that differs from
  `initialTarget.engine`
- **THEN** Session creation MUST fail closed
- **AND** the system MUST NOT silently choose either value

#### Scenario: create-time models match the default provider profile

- **WHEN** Shared Session creation resolves default Provider P for engine E
- **THEN** `initialTarget` model catalog entry id and runtime model MUST be chosen from models
  loaded for `(E, P)` under authoritative load rules
- **AND** if P is local/default, the load MUST force-refresh local settings rather than reuse a
  stale engine-wide model cache
- **AND** if P is managed, the load MUST use provider-scoped configuration for P
- **AND** `providerProfileNameSnapshot` / `providerProfileSource` MUST describe P (local →
  disk + local label; managed → managed id/name)

## ADDED Requirements

### Requirement: Shared Session Open MUST Not Re-Seed Create Defaults

Hydrating or activating an existing Shared Session MUST publish the durable next target as the
Composer authority. The create-time “first provider + default model” algorithm MUST run only on
new session creation, never as a silent reseed on open.

#### Scenario: activate existing session keeps durable next target

- **WHEN** a Shared Session already stores a complete `selectedTarget`
- **AND** the client activates that session
- **THEN** `selectedNextTarget` MUST equal that durable target
- **AND** the system MUST NOT replace it with a newly computed first-provider default

#### Scenario: create and open remain separate authorities

- **WHEN** session A is newly created with first-provider default D
- **AND** session B was previously used with target T ≠ D
- **THEN** activating B MUST show T
- **AND** activating A MUST show D until the user changes the picker
