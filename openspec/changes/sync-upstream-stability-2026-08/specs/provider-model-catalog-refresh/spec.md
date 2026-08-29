## ADDED Requirements

### Requirement: Codex managed catalogs MUST not invent official fallback rows

A provider-scoped Codex catalog MUST contain only rows declared/configured/discovered for that provider plus explicitly user-managed rows allowed by the current catalog contract. Official generated fallback models MUST NOT be appended merely because the engine is Codex.

#### Scenario: Third-party Codex provider exposes a subset
- **WHEN** the selected managed provider exposes only provider-specific models
- **THEN** the picker MUST show only those scoped models and valid user-managed rows
- **AND** it MUST NOT show uncallable official OpenAI fallback models

#### Scenario: Scoped catalog is empty
- **WHEN** a valid managed Codex provider yields no models
- **THEN** the existing configured-default/custom-model guidance MAY render
- **AND** the system MUST NOT synthesize an official selectable catalog

### Requirement: Product catalog authority MUST remain endpoint-protocol based

Provider-scoped catalog fixes MUST NOT replace or widen the Product model projection owned by endpoint-level API protocol metadata and `projectProductTargetCatalogV1`.

#### Scenario: Product model appears for multiple exact endpoints
- **WHEN** a managed Product row is authorized for both Responses and Chat Completions
- **THEN** it MAY remain available to Codex and Kimi through the Product projection
- **AND** legacy provider fallback removal MUST NOT hide or duplicate that Product row
