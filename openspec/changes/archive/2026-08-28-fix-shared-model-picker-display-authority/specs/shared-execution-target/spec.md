## ADDED Requirements

### Requirement: Atomic Closed Trigger MUST Prefer Execution Target Snapshot For Selection Display

When the composer Atomic target picker is active (`targetGroups` / Shared or create-session Atomic mode), the closed-state model trigger MUST treat `executionTarget` model identity as the selection-display authority. Provider-scoped model catalog rows MAY enrich the label when a matching row is loaded, but catalog miss MUST NOT collapse a present `executionTarget` model identity into the empty “select model” placeholder.

#### Scenario: complete shared target shows model before catalog load

- **WHEN** a Shared Session has a complete `selectedNextTarget` with engine, model identity, and local/managed provider snapshot
- **AND** the Atomic model catalog for that engine+profile has not been loaded yet (user has not opened the menu)
- **THEN** the closed model trigger MUST display a non-empty model label derived from `executionTarget.modelCatalogEntryId` and/or `executionTarget.model`
- **AND** MUST NOT show only the empty select-model placeholder

#### Scenario: wrong parent models do not hide shared selection

- **WHEN** Atomic mode is active with a complete `executionTarget` for engine Grok
- **AND** the parent composer `models` prop still contains only another engine’s catalog (non-empty)
- **THEN** the closed trigger MUST still display the Grok `executionTarget` model identity
- **AND** MUST NOT require a catalog hit in the foreign parent models list

#### Scenario: catalog hit still preferred when available

- **WHEN** Atomic mode has a complete `executionTarget` and the matching provider-scoped catalog row is loaded
- **THEN** the closed trigger MAY use the catalog row’s display label / provider-scoped runtime name
- **AND** the selected identity MUST remain the same `executionTarget` model entry

### Requirement: Shared Composer MUST NOT Borrow Global Model Selection For Atomic Selected State

While the active conversation is a Shared Session, the Atomic picker selected-state props MUST NOT fall back to the global/Native composer `selectedModelId` when `selectedNextTarget` is absent or incomplete. Empty next-target MUST render as unselected in the picker and MUST remain fail-closed for V2 send.

#### Scenario: null next target stays unselected

- **WHEN** the active thread is Shared and `selectedNextTarget` is null or not a resolved execution target
- **AND** the global composer still holds a non-null Native/global `selectedModelId`
- **THEN** the Atomic closed trigger MUST show the unselected state
- **AND** the Shared send path MUST continue to reject incomplete targets (existing V2 contract)

#### Scenario: complete next target ignores global selectedModelId

- **WHEN** Shared `selectedNextTarget` is complete with model M
- **AND** global `selectedModelId` is a different model N
- **THEN** the Atomic closed trigger and selection identity MUST follow M
- **AND** MUST NOT display N as the Shared selection

### Requirement: Shared Complete Next Target MUST Eagerly Ensure Provider Catalog As Enrichment

When Shared Session holds a complete `selectedNextTarget`, the composer MUST request the provider-scoped model catalog for that target’s engine and provider profile (mapping local/default to the engine’s local profile sentinel). Catalog load failure MUST NOT clear `selectedNextTarget` or revert the closed trigger to empty placeholder solely due to load failure.

#### Scenario: ensure models after shared target hydrate

- **WHEN** Shared history or create hydrates a complete `selectedNextTarget`
- **THEN** the system MUST invoke catalog ensure for that engine+profile without requiring the user to open the model menu first
- **AND** a later successful catalog load MAY upgrade the display label without changing the selected identity

#### Scenario: ensure failure does not wipe target

- **WHEN** catalog ensure for the current Shared next target fails or returns empty
- **THEN** `selectedNextTarget` MUST remain unchanged
- **AND** the closed trigger MUST continue to display snapshot-based model identity when present
