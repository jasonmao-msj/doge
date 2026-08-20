## MODIFIED Requirements

### Requirement: New-session defaults SHALL prefer a prepared managed account provider without overriding explicit intent

For a signed-in account with a successfully prepared and active supported engine entitlement, a newly created Codex or Claude session with no explicit provider selection MUST bind `doge-token-matrix` as its managed `providerProfileId`. The frontend MUST resolve the selected engine's model against that provider-scoped catalog before creation.

This default applies only to new-session creation. Existing thread bindings, explicit local/disk/manual provider selection, Local Mode, signed-out state, inactive entitlement, and failed preparation MUST retain their previous behavior.

#### Scenario: eligible account creates a new Codex session

- **WHEN** account onboarding has successfully prepared the active Codex entitlement
- **AND** the user creates a new Codex session without choosing a provider
- **THEN** the creation target MUST carry `providerProfileId = "doge-token-matrix"`
- **AND** its model/catalog entry MUST be resolved from that provider's catalog
- **AND** it MUST NOT send a disk/local model id to the managed provider

#### Scenario: explicit local choice remains authoritative

- **WHEN** the user explicitly selects a local/disk/manual provider for a new eligible engine session
- **THEN** the selected provider MUST remain the creation target
- **AND** Doge MUST NOT inject `doge-token-matrix`

#### Scenario: managed catalog cannot be resolved

- **WHEN** an eligible managed default has no usable provider-scoped catalog
- **THEN** creation MUST follow the existing unavailable/diagnostic behavior
- **AND** it MUST NOT silently retry through the local/disk provider
