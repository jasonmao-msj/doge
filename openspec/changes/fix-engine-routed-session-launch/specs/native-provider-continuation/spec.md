# Native Provider Continuation engine routing

## MODIFIED Requirements

### Requirement: Confirm destination engine before continuation hydration

Provider Continuation MUST confirm the destination `EngineType` as the native runtime authority before persisting destination Composer state or selecting the target thread. A failed confirmation MUST leave the source session active and MUST NOT navigate to a target whose Composer would be attributed to the source engine.

#### Scenario: Continuation changes a non-Codex source to Codex

- **WHEN** a ready continuation returns a Codex destination
- **THEN** the frontend confirms native Codex, persists the exact target model/effort, and selects the target thread
- **AND** the Composer displays Codex-owned engine/model state on the first target render

#### Scenario: Destination engine confirmation fails

- **WHEN** native engine confirmation returns failure
- **THEN** the continuation remains on the existing error/recovery surface
- **AND** no target thread navigation or second-provider operation is started
