## ADDED Requirements

### Requirement: Squad Canonical Facts MUST Preserve Single-Writer Event Semantics
The event store MUST append versioned Squad Canonical Facts through the existing `SharedEventWriter` and MUST preserve atomic sequence allocation, deterministic checksum, idempotency conflict detection, and monotonic migrations.

#### Scenario: squad append uses the existing writer
- **WHEN** a run, plan, node, lease, cancellation, or settlement fact is committed
- **THEN** sequence allocation and event insertion occur through `SharedEventWriter` with no second event sink or direct SQLite writer

#### Scenario: same identity with conflicting squad payload
- **WHEN** a caller reuses a Squad fact idempotency identity with different canonical content
- **THEN** the writer returns an idempotency conflict and stores neither a replacement nor an additional event

#### Scenario: old database opens after additive migration
- **WHEN** a database created before Squad support is opened repeatedly
- **THEN** additive schema migration is idempotent and existing Shared facts remain readable
