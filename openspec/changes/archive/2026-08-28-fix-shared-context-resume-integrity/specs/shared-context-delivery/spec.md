## ADDED Requirements

### Requirement: Accepted no-replay applies only while native context trust is trusted

The rule that an accepted package MUST NOT be replayed after a failed run applies while the binding's native context trust is `trusted`. When trust is `dirty`, the system MUST allow a new Context Package identity that rematerializes required Shared history for the next delivery.

#### Scenario: dirty trust allows rematerialized package after prior accept

- **WHEN** a prior package was accepted for the binding
- **AND** trust is later marked `dirty`
- **AND** the next prepare detects zero-transfer with needs-history
- **THEN** prepare_delivery MUST be allowed to create a new full package
- **AND** it MUST NOT claim `no-context-transfer-required` solely because the accepted cursor advanced

#### Scenario: trusted keep no-replay for empty incremental packages

- **WHEN** trust is `trusted`
- **AND** empty-handoff rematerialize is not required
- **THEN** retry MUST NOT re-inject the previously accepted full package as a blind replay

### Requirement: no-context-transfer-required MUST be honest under trust

The system MUST record `no-context-transfer-required` only when the package is zero-transfer and either needs-history is false, or needs-history is true and trust is `trusted` (native-held history assumption). Needs-history + `dirty` MUST rematerialize or fail closed, including when the incremental package is non-empty but incomplete.

#### Scenario: dirty continue-only package is not no-transfer-required

- **WHEN** needs-history is true
- **AND** trust is `dirty`
- **AND** the incremental package only contains short continue turns after the accepted cursor
- **THEN** delivery MUST rematerialize a full package or return a primary `empty-context-handoff:` error
- **AND** MUST NOT set context evidence to `no-context-transfer-required`
