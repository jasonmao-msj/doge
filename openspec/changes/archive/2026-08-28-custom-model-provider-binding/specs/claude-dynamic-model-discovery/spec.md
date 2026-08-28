## ADDED Requirements

### Requirement: Claude Custom Models MAY Carry Provider Ownership Provenance

Claude user-added custom models in the engine catalog MAY include `providerProfileId` when they are owned by a managed Claude provider. Catalog merge MUST keep provider-owned and local/unscoped custom models visible and selectable. Claude custom model id validation MUST remain shape-only.

#### Scenario: provider-owned Claude custom model appears in catalog
- **WHEN** a managed Claude provider stores a custom model in `customModels`
- **THEN** the Claude model catalog MUST include that model
- **AND** the catalog entry SHOULD carry `providerProfileId` equal to that provider when projected through the custom model store

#### Scenario: local Claude custom model remains without provider binding
- **WHEN** the user has a Claude custom model without `providerProfileId`
- **THEN** the model MUST remain present in the merged Claude model catalog
- **AND** it MUST remain selectable

#### Scenario: shape-only validation still applies
- **WHEN** the user adds a Claude custom model with id containing spaces or provider-specific syntax
- **AND** the model is bound to a managed Claude provider or local configuration
- **THEN** the system MUST NOT reject the id solely for official naming pattern mismatch
