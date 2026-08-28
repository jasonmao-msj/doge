## MODIFIED Requirements

### Requirement: Kanban Engine/Model Selector MUST Reuse The Active Catalog Authority

Kanban task create/edit MUST use the same catalog authority as the current product mode. When Product entitlement is
ready, Kanban MUST use the canonical Product execution target catalog for every entitled engine and MUST NOT read
`EngineStatus.models` or a Codex-only prop as fallback. In Local Mode, Kanban MUST preserve the existing hydrated
Codex catalog and local engine status catalogs. Selection normalization MUST preserve a still-valid exact target and
otherwise fall back deterministically within the selected engine only.

#### Scenario: Product Kanban matches Composer for every entitled engine

- **WHEN** Product entitlement is ready and the user selects Codex, Claude, or Kimi in Kanban
- **THEN** model ids, runtime values, order, and display labels MUST match the canonical Product catalog rows used by
  Composer for that engine
- **AND** local detection-only engines/models MUST NOT appear

#### Scenario: Local Kanban preserves upstream behavior

- **WHEN** Product entitlement is not ready
- **THEN** Codex MUST continue to use the hydrated Composer Codex catalog
- **AND** other locally installed engines MUST continue to use their local engine catalog
- **AND** uninstalled local engines MAY remain visible as disabled options

#### Scenario: Valid exact target survives catalog refresh

- **WHEN** the current engine/catalog/runtime target still exists after refresh
- **THEN** Kanban MUST preserve the selection
- **AND** it MUST NOT compare only an ambiguous model id shared by another engine

#### Scenario: Missing target falls back within the selected engine

- **WHEN** the current target no longer exists
- **THEN** selector MUST choose that engine's default target or first target
- **AND** an engine with no compatible target MUST remain empty/disabled
- **AND** the selector MUST NOT borrow a model from the previously selected engine

#### Scenario: Selected exact target reaches task payload

- **WHEN** the user creates or updates a Kanban task
- **THEN** task payload MUST preserve the selected exact `ExecutionTarget`
- **AND** backward-compatible `engineType/modelId` fields MUST mirror its engine/catalog identity

