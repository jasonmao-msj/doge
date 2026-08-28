## ADDED Requirements

### Requirement: Exact Turn-Bound Provisional Identity MUST Not Depend On Prefix Shape

When an engine publishes a canonical native session identity, frontend MUST recognize a provisional logical owner from explicit engine metadata and exact active turn identity even if its thread id does not use the conventional engine pending prefix.

#### Scenario: Unprefixed provisional owner matches engine and turn

- **WHEN** a logical thread has the requested `engineSource`, lacks that engine's canonical session prefix, and owns the exact incoming `turnId`
- **THEN** pending-to-canonical resolution MUST return that logical thread as the promotion source
- **AND** canonical promotion MUST install the same bounded alias forwarding used by conventional pending ids

#### Scenario: Engine or turn does not match

- **WHEN** an unprefixed thread has a different `engineSource` or a different active turn
- **THEN** it MUST NOT be selected as a provisional promotion source
- **AND** active UI selection alone MUST NOT authorize rebinding

#### Scenario: Terminal arrives immediately after canonical promotion

- **WHEN** terminal evidence targets the canonical engine thread before reducer state reflects the preceding rename
- **THEN** terminal resolution MUST use the exact turn-bound provisional alias
- **AND** it MUST clear processing and active-turn residue on both logical identities idempotently
