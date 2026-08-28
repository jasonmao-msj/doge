## ADDED Requirements

### Requirement: Claude Managed Providers MUST Persist Provider-Owned Custom Models

Claude managed provider profiles MUST support an optional `customModels` collection with the same structural fields as Codex custom models (`id`, `label`, optional `description`). Add, update, load, and delete of Claude providers MUST preserve `customModels` through the vendors config store. Local settings provider MUST NOT require `customModels`.

#### Scenario: update Claude provider preserves customModels
- **WHEN** the client updates a managed Claude provider with a non-empty `customModels` array
- **THEN** a subsequent load of Claude providers MUST return those custom models on that provider
- **AND** other provider fields (name, settingsConfig, sortOrder) MUST remain intact

#### Scenario: legacy providers without customModels still load
- **WHEN** a stored Claude provider JSON omits `customModels`
- **THEN** loading providers MUST succeed
- **AND** `customModels` MUST be treated as empty / absent

#### Scenario: model manager write uses Claude provider update path
- **WHEN** the custom model manager binds a Claude custom model to managed provider B
- **THEN** the system MUST persist the model via the Claude provider update path into B’s `customModels`
