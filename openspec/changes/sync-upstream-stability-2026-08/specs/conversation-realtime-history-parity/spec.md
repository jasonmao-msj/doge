## ADDED Requirements

### Requirement: Terminal settlement MUST preserve all accepted assistant text across batched channels

Before a turn terminal barrier is established, the frontend MUST synchronously drain every accepted content queue for that turn, including legacy delta queues, normalized operation queues, the normalized contract batcher, and the externalized live text tail.

#### Scenario: Cadence batch contains the final text segment
- **WHEN** a normalized assistant delta is queued in the contract batcher and `turn/completed` arrives before its cadence flush
- **THEN** the queued delta MUST be applied synchronously before terminal quarantine
- **AND** the durable reducer state MUST contain the complete assistant text

#### Scenario: Deferred completion eventually settles
- **WHEN** turn completion is temporarily deferred by an active blocker
- **THEN** the final settlement path MUST perform the same complete drain before installing its terminal barrier

### Requirement: A late complete assistant snapshot MAY repair content but MUST NOT revive lifecycle

After terminal quarantine, a normalized non-empty assistant `completeAgentMessage` for the exact turn MAY be merged into durable content as salvage. Other late deltas/items MUST remain rejected, and salvage MUST NOT mark processing, set an active turn, or create a second terminal.

#### Scenario: Full snapshot arrives after terminal
- **WHEN** terminal is recorded and an exact-turn non-empty assistant completion snapshot arrives later
- **THEN** the snapshot MUST merge using the existing longer/final-text semantics
- **AND** processing MUST remain false and terminal cardinality MUST remain one

#### Scenario: Late incremental event arrives after terminal
- **WHEN** an assistant delta, tool update, reasoning delta, or mismatched completion arrives after terminal quarantine
- **THEN** the event MUST remain dropped/diagnostic-only
