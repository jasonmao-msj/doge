## ADDED Requirements

### Requirement: Non-Codex And Shared Assistant Aliases MUST Converge Before Terminal Settlement

Lifecycle consumers MUST converge equivalent assistant observations that arrive under different item ids or event aliases before terminal settlement for **Claude Native**, **Shared sessions**, and other engines that share the conversation reducer — not only Codex. Shared `threadKind` MUST NOT disable this convergence. Tool-separated non-equivalent segments MUST remain distinct.

#### Scenario: claude native alias completion converges

- **WHEN** the current engine is Claude on a Native thread
- **AND** equivalent assistant content is completed under a second item id in the same user turn
- **THEN** lifecycle consumers MUST leave exactly one completed assistant message
- **AND** terminal settlement MUST NOT leave two adjacent identical assistant bubbles

#### Scenario: shared session alias completion converges

- **WHEN** the thread is a Shared session (any supported bound engine)
- **AND** equivalent assistant content is observed under multiple item ids without an intervening user or tool boundary
- **THEN** lifecycle consumers MUST converge to one assistant message
- **AND** MUST NOT skip convergence solely because the thread is Shared

#### Scenario: tool boundary still protects real multi-segment replies

- **WHEN** two assistant bodies are separated by tool activity and are not equivalent
- **THEN** both segments MUST remain after terminal settlement
