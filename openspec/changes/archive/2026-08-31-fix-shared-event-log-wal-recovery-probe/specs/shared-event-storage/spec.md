## MODIFIED Requirements

### Requirement: Startup Recovery MUST Fail Closed on Integrity Problems

On open, an existing non-empty database MUST pass `PRAGMA quick_check(1)`, limiting reported errors to one without claiming a wall-clock timeout. The store MUST prefer a read-only integrity probe. If and only if that probe returns SQLite `READONLY` because an unclean WAL requires recovery, the store MUST retry with a read-write, no-create connection placed in `query_only` mode before deciding that integrity failed. A failed integrity decision MUST open read-only recovery mode and MUST NOT delete, rename, or overwrite the damaged file.

#### Scenario: hot WAL is recovered before corruption classification

- **WHEN** a previous writer is killed after committing WAL frames and a read-only `quick_check` returns SQLite `READONLY`
- **THEN** the store MUST retry `quick_check(1)` using a read-write connection without `CREATE`
- **AND** it MUST enable `query_only` before issuing the check
- **AND** a passing second check MUST return the normal writable store rather than `ReadOnlyRecovery`

#### Scenario: damaged database enters read-only recovery

- **WHEN** the integrity check reports corruption, or the bounded access-mode fallback still cannot establish a passing integrity result
- **THEN** the store MUST return a read-only recovery outcome with a typed reason
- **AND** it MUST NOT create an empty database over the existing file
- **AND** a missing database file MAY be created fresh
