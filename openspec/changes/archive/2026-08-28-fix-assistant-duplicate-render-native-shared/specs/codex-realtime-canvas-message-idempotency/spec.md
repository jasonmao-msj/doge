## ADDED Requirements

### Requirement: Shared Sessions MUST Participate In Equivalent Assistant Convergence

Codex-specific event-shape idempotency MAY remain Codex-focused, but the product MUST NOT leave Shared sessions without equivalent assistant cross-id convergence. When a Shared thread is bound to Codex or another engine, equivalent assistant observations under different item ids in the same user turn MUST converge using the shared reducer convergence path. Shared `threadKind` MUST NOT force-disable cross-id assistant convergence.

#### Scenario: shared thread no longer skips cross-id assistant convergence

- **WHEN** `threadKind` is `shared`
- **AND** two equivalent assistant completions arrive with different item ids without a user/tool boundary
- **THEN** conversation state MUST contain one assistant message for that semantic response
- **AND** the previous “Shared disables Codex-style dedupe” behavior MUST NOT leave duplicate bubbles

#### Scenario: native codex regressions remain green

- **WHEN** Native Codex receives the existing alias, fallback, snapshot-repeat, and upsert-alias sequences
- **THEN** idempotency outcomes MUST match the existing Codex requirements
- **AND** Shared enablement MUST NOT weaken Native Codex convergence
