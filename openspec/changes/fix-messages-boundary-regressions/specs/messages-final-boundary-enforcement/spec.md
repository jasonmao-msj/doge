## MODIFIED Requirements

### Requirement: External features cannot deep-import messages private modules

Code outside `src/features/messages` MUST import Messages-owned runtime/presentation surfaces only through `src/features/messages/index.ts` or consume the capability from its explicit neutral owner. A neutral owner MUST contain the canonical implementation; it MUST NOT be a re-export shim that merely hides a peer feature dependency.

#### Scenario: external feature imports a private messages path

- **WHEN** composer、layout、threads or another external feature imports messages components、utils、rendering、rows、timeline、orchestration or another private path
- **THEN** `check:messages-boundaries` fails with the exact source and specifier

#### Scenario: shared capability has multiple feature consumers

- **WHEN** Messages and one or more peer features consume the same runtime、presentation、contract、service or pure utility capability
- **THEN** the canonical implementation MUST live in an explicit neutral owner or be composed by a higher-level host
- **AND** Messages MUST NOT import the peer feature implementation through a compatibility re-export

### Requirement: Boundary enforcement is deterministic and active in CI

The checker MUST have fixture-based tests for all final rules and MUST run in the repository CI contract sequence. The outbound debt baseline MUST equal the accepted current graph and MUST shrink when an accepted edge is repaid; a CI failure MUST NOT be repaired by adding newly introduced edges to the baseline.

#### Scenario: CI evaluates the final graph

- **WHEN** a pull request introduces a forbidden dependency edge
- **THEN** deterministic tests and `npm run check:messages-boundaries` fail before merge

#### Scenario: a neutral owner move removes an accepted outbound edge

- **WHEN** a previously baselined Messages-to-peer import is migrated to a neutral owner
- **THEN** the exact baseline MUST remove that stale entry in the same change
- **AND** reintroducing the peer import MUST fail as a new violation
