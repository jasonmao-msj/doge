## ADDED Requirements

### Requirement: Add Model Open Path MUST Prefer Active Or Requested Provider For Binding Default

When the composer (or host) opens the custom model manager in add mode for Claude or Codex, the dialog’s provider binding default MUST prefer an explicit requested provider profile id when provided; otherwise it MUST prefer the engine’s currently active managed provider; it MUST NOT silently force local configuration when an active managed provider exists.

#### Scenario: active managed provider becomes default binding
- **WHEN** Codex has an active managed provider A
- **AND** the user opens the custom model manager in add mode without an explicit preferred provider profile id
- **THEN** the add form’s provider selector MUST default to A

#### Scenario: explicit preferred provider profile wins
- **WHEN** the open request carries `preferredProviderProfileId` equal to managed provider B
- **AND** B is present in the engine provider list
- **THEN** the add form’s provider selector MUST default to B even if another provider is active

#### Scenario: no managed provider falls back to local
- **WHEN** the engine has no managed third-party providers
- **AND** the user opens the custom model manager in add mode
- **THEN** the provider selector MUST default to local configuration
