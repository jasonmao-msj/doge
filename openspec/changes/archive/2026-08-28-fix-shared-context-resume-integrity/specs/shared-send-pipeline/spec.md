## ADDED Requirements

### Requirement: Send pipeline MUST honor dirty rematerialize before Runtime dispatch

After begin_turn succeeds, prepare_delivery MUST apply native context trust rules before dispatch. A rematerialized non-empty package MUST be the artifact used for Runtime delivery. An `empty-context-handoff` result MUST block normal Runtime user delivery for that attempt.

#### Scenario: dirty rematerialized prepare continues dispatch

- **WHEN** prepare_delivery returns ready with `rematerialized=true` and non-empty transfer payload
- **THEN** dispatch MUST use that artifact
- **AND** outbound prompt-prefix or import path MUST include rematerialized Shared history

#### Scenario: empty-context-handoff blocks dispatch

- **WHEN** prepare_delivery returns `empty-context-handoff`
- **THEN** the pipeline MUST NOT treat the attempt as a successful zero-transfer send
- **AND** recovery contracts remain available for the attempt/session

### Requirement: Post-rebuild first send MUST transfer history when present

After explicit binding rebuild (native cleared, trust dirty), the next successful prepare_delivery on a non-empty Shared session MUST produce a non-zero transfer package subject to budget/checkpoint compression.

#### Scenario: post-rebuild short continue includes context

- **WHEN** the user rebuilds a binding on a Shared session with prior Canonical user history
- **AND** the next user message is a short continue instruction
- **THEN** prepare_delivery MUST yield non-empty prompt-prefix or import items
