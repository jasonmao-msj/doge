# shared-event-storage Specification

## Purpose

定义 Shared Session V2 的 SQLite WAL Canonical Event Storage：六表 schema 与
migration 保留项、单写者 Actor、事务内 sequence 分配、幂等、Provider Usage
Ledger、integrity recovery 与 crash all-or-nothing contract。

## Requirements
### Requirement: Event Storage MUST Use SQLite WAL With Single-Writer Transaction Semantics

The store MUST use SQLite in WAL mode with `foreign_keys=ON`, `synchronous=FULL`, and a bounded `busy_timeout`; all writes MUST go through one `SharedEventWriter` actor, and event insert plus per-session sequence allocation MUST commit in one SQLite transaction. Canonical-fidelity facts MUST enter through `SharedEventWriter::append_canonical_fact`, which validates payload fields before delegating to the actor.

#### Scenario: sequence allocation and event insert are atomic

- **WHEN** an event is appended for a session
- **THEN** the new sequence value and the event row MUST be committed in the same transaction
- **AND** if any statement in that transaction fails, both the event row and the `next_sequence` bump MUST roll back
- **AND** per-session sequence MUST be monotonic, with gaps permitted after crashes but never duplicates

#### Scenario: single writer authority

- **WHEN** any component wants to persist a canonical event, binding state, cursor, or usage record
- **THEN** it MUST go through `SharedEventWriter`
- **AND** no API MUST allow callers to supply their own sequence values
- **AND** frontend, renderers, and engine adapters MUST NOT write the database directly

#### Scenario: cloned handles cannot terminate active callers

- **WHEN** more than one `SharedEventWriter` handle exists
- **THEN** shutdown from a clone MUST be rejected with a typed error
- **AND** the actor MUST remain usable until only the final handle requests shutdown

#### Scenario: direct arbitrary envelope append is rejected

- **WHEN** a caller tries to append a raw JSON envelope as a canonical-fidelity fact
- **THEN** the public canonical API rejects it before sequence allocation
- **AND** presentation-only shadow facts remain available only through their explicit entry point

### Requirement: Event Writes MUST Be Idempotent Across Three Keys

Repeated appends MUST NOT create duplicate facts: `PRIMARY KEY (session_id, event_id)`, a partial unique index on `(session_id, attempt_id, fact_type)` excluding usage facts, and a partial unique index on `(session_id, fact_type, dedupe_key)`.

#### Scenario: repeated append returns duplicate outcome

- **WHEN** an event with an already-persisted `event_id` is appended again, including 100 repetitions
- **THEN** exactly one row MUST exist
- **AND** the writer MUST return a duplicate outcome carrying the existing sequence instead of an error

#### Scenario: same idempotency key with different content is a conflict

- **WHEN** an event or Ledger record reuses an existing idempotency key with a different payload checksum
- **THEN** the writer MUST reject it with typed `IdempotencyConflict`
- **AND** it MUST NOT report the divergent write as a successful duplicate

#### Scenario: usage facts dedupe by usageRecordId only

- **WHEN** two `conversation.usageRecorded` facts share one `attemptId` but have different `usageRecordId` values
- **THEN** both MUST be stored
- **WHEN** the same `usageRecordId` is replayed
- **THEN** it MUST be deduplicated without a second row

### Requirement: Provider Usage Ledger MUST Be Independently Owned and Revision-Idempotent

`provider_usage_aggregate_log` MUST be keyed by `(provider_profile_id, window_started_at, window_ended_at, report_subject_id, revision)`, MUST NOT carry any session identifier, and MUST validate the supersede chain.

#### Scenario: ledger replay and revision chain

- **WHEN** the same provider-window-subject-revision record is written 100 times
- **THEN** exactly one row MUST exist
- **WHEN** a new revision is recorded
- **THEN** its revision MUST equal the current highest plus one and its `supersedesUsageRecordId` MUST reference the current highest record
- **AND** a revision that skips a number MUST be rejected with a typed error

### Requirement: Payload Checksum MUST Use Deterministic Serialization

`payload_checksum` MUST be `SHA-256` of the UTF-8 deterministic JSON of `schemaVersion + factType + payload`, where deterministic JSON fixes object key ordering, whitespace, and number encoding; the writer MUST compute it internally rather than trusting caller input.

#### Scenario: checksum stability across producers

- **WHEN** two semantically identical payloads with different key order or whitespace are appended
- **THEN** their computed checksums MUST be identical
- **AND** the checksum format MUST carry the `sha256:` algorithm prefix

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

### Requirement: Storage MUST Survive Kills at Any Transaction Boundary

The store MUST prove all-or-nothing commit behavior when the process is killed before, during, or after any transaction boundary, and after restart repeated appends MUST remain idempotent.

#### Scenario: kill at transaction boundaries

- **WHEN** the process is SIGKILLed before insert, after sequence bump before insert, before commit, or immediately after commit returns
- **THEN** after restart each session's events MUST equal exactly the set of committed appends with no partial rows
- **AND** `PRAGMA quick_check` MUST pass
- **AND** re-appending an event that was acknowledged before the kill MUST return the duplicate outcome

#### Scenario: random kills never corrupt

- **WHEN** the process is killed at randomized points across at least 50 write iterations
- **THEN** restart MUST show no partial transactions, no duplicate sequences, and a passing integrity check

### Requirement: Schema Migrations MUST Be Monotonic and Idempotent

Schema versioning MUST use `PRAGMA user_version` with monotonic migration steps executed at open, and migration failure MUST fail closed.

#### Scenario: repeated open is stable

- **WHEN** the store is opened repeatedly
- **THEN** migrations MUST run at most once per version
- **AND** the six required tables MUST exist: `shared_sessions_v2`, `shared_event_log`, `shared_binding_state`, `shared_projection_checkpoint`, `shared_legacy_import`, `provider_usage_aggregate_log`
