## ADDED Requirements

### Requirement: Custom Model Manager MUST Require Provider Binding On Add And Edit

When the user adds or edits a Claude Code or Codex custom model in the custom model manager dialog, the form MUST present a provider selector before model id/label fields. The selector MUST include a local-configuration option and the engine’s managed third-party providers.

#### Scenario: add form shows provider selector first
- **WHEN** the user opens the custom model manager for Claude or Codex and starts adding a model
- **THEN** the form MUST show a provider selector
- **AND** the selector MUST list local configuration and managed third-party providers for that engine

#### Scenario: edit form prefills provider ownership
- **WHEN** the user edits an existing custom model that carries a `providerProfileId`
- **THEN** the provider selector MUST preselect that provider
- **AND** changing the selection and saving MUST rebind the model to the newly selected provider

### Requirement: Managed Provider Selection MUST Write Provider-Owned Custom Models

Saving a custom model with a managed provider selected MUST persist the model on that provider’s `customModels` and MUST mirror it into the engine-level custom model catalog with `providerProfileId` set to that provider.

#### Scenario: Codex managed save writes provider and catalog
- **WHEN** the user saves a Codex custom model bound to managed provider A
- **THEN** provider A’s `customModels` MUST include that model
- **AND** the Codex engine custom model catalog MUST include an entry with the same id and `providerProfileId` equal to A

#### Scenario: Claude managed save writes provider and catalog
- **WHEN** the user saves a Claude custom model bound to managed provider B
- **THEN** provider B’s `customModels` MUST include that model
- **AND** the Claude engine custom model catalog MUST include an entry with the same id and `providerProfileId` equal to B

#### Scenario: local configuration does not write managed providers
- **WHEN** the user saves a custom model with the local configuration option selected
- **THEN** the system MUST write the model only to the engine-level custom model catalog without `providerProfileId`
- **AND** it MUST NOT append the model to any managed provider’s `customModels`

### Requirement: List View MUST Show Provider Ownership

The custom model manager list MUST make each model’s provider ownership visible (managed provider name or local configuration).

#### Scenario: managed model shows provider name
- **WHEN** a listed custom model has `providerProfileId` matching a known provider
- **THEN** the list row MUST show that provider’s display name (or equivalent ownership badge)

#### Scenario: unscoped historical model shows local
- **WHEN** a listed custom model has no `providerProfileId`
- **THEN** the list row MUST present it as local configuration ownership

### Requirement: Delete And Rebind MUST Stay Bidirectionally Consistent

Deleting or rebinding a provider-owned custom model MUST update both the provider store and the engine-level catalog so neither side retains a stale ghost entry.

#### Scenario: delete removes from provider and catalog
- **WHEN** the user deletes a custom model owned by provider A
- **THEN** provider A’s `customModels` MUST no longer contain that model id
- **AND** the engine-level catalog MUST no longer contain that model id

#### Scenario: rebind moves between providers
- **WHEN** the user changes a model’s ownership from provider A to provider B and saves
- **THEN** provider A MUST no longer list the model
- **AND** provider B MUST list the model
- **AND** the catalog entry MUST show `providerProfileId` equal to B

### Requirement: Claude And Codex MUST Share The Same Binding UX Contract

Claude Code and Codex MUST expose the same provider-binding interaction in the custom model manager (selector placement, local option, managed write-back, list ownership). Validation differences (Claude shape-only vs Codex model-id) MAY remain.

#### Scenario: both engines offer local plus managed options
- **WHEN** the custom model manager is open for Claude
- **AND** when it is open for Codex
- **THEN** both sessions MUST offer local configuration plus that engine’s managed providers in the add/edit provider selector
