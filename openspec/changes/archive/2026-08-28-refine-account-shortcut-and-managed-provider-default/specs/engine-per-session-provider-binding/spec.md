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

#### Scenario: selected subscribed engine is not prepared in the current process

- **GIVEN** the authenticated account has an active entitlement for the selected Codex or Claude engine
- **AND** another engine was the last successfully prepared engine
- **WHEN** the user opens the new-session surface for the selected unprepared engine
- **THEN** Doge MUST automatically request the existing Account Gate preparation flow for that engine
- **AND** it MUST NOT silently settle on the local/disk provider as the new-session default
- **AND** after preparation succeeds, the fresh creation target MUST resolve `doge-token-matrix`

#### Scenario: every subscribed engine submenu projects its own managed default

- **GIVEN** the authenticated account has active entitlements for both Codex and Claude
- **AND** the Home creation target currently points to one of those engines
- **WHEN** the user opens the other engine's model submenu
- **THEN** that submenu MUST default its channel to `doge-token-matrix`
- **AND** its model rows MUST come from that managed provider profile
- **AND** this projection MUST NOT change an existing Native or Shared session's durable provider binding

#### Scenario: explicit local choice remains authoritative

- **WHEN** the user explicitly selects a local/disk/manual provider for a new eligible engine session
- **THEN** the selected provider MUST remain the creation target
- **AND** Doge MUST NOT inject `doge-token-matrix`

#### Scenario: a new creation does not inherit the previous session's explicit provider

- **GIVEN** an eligible user explicitly selected a local or manual provider while creating one session
- **WHEN** that session has been created and the user opens a new conversation
- **THEN** the created session MUST retain its explicit durable provider binding
- **AND** the new creation surface MUST discard the previous transient selection
- **AND** it MUST resolve `doge-token-matrix` as the fresh default for the prepared engine

#### Scenario: managed catalog cannot be resolved

- **WHEN** an eligible managed default has no usable provider-scoped catalog
- **THEN** creation MUST follow the existing unavailable/diagnostic behavior
- **AND** it MUST NOT silently retry through the local/disk provider

#### Scenario: existing local session selects the managed provider on the same engine

- **GIVEN** an existing Codex or Claude session is durably bound to a local/manual provider
- **WHEN** the user explicitly selects `doge-token-matrix` without changing the engine
- **THEN** Doge MUST run the existing managed Account Gate prepare transaction before creating a Provider Continuation
- **AND** it MUST re-confirm native vault readiness even if the renderer previously marked that engine `prepared`
- **AND** it MUST NOT create the managed continuation before preparation succeeds
- **AND** the source session MUST preserve its durable local/manual provider binding
