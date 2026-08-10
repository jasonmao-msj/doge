## ADDED Requirements

### Requirement: doge brand vocabulary MUST be locale-complete

Every locale registered by the current WebView locale index MUST provide doge product name, brand story surfaces, user-visible doge storage-path hints and feedback/update copy with the same namespace keys and interpolation placeholders. A supported locale MUST NOT fall back to a legacy product name.

#### Scenario: Brand copy is added or changed

- **WHEN** a doge product-name, About, home, lock-screen, settings, update, feedback or storage-path localization key changes
- **THEN** every registered locale bundle MUST expose the corresponding key
- **AND** interpolation placeholders MUST match the source locale

#### Scenario: User switches across published locales

- **WHEN** the user selects any locale registered by `src/i18n/index.ts`
- **THEN** product copy MUST identify doge
- **AND** visible app-home examples MUST use `~/.doge`
- **AND** legacy `ccgui`, `mossx` or `codemoss` wording MUST NOT appear as current product branding

#### Scenario: Legacy migration is explained

- **WHEN** UI must explain an imported legacy location
- **THEN** the legacy name MAY appear only as the source of an explicit migration/compatibility message
- **AND** doge MUST remain the destination/current product
