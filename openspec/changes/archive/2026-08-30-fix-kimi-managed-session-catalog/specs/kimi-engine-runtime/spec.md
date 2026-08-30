## ADDED Requirements

### Requirement: Managed Kimi History MUST Remain Restart-Compatible

Managed Kimi runtime history MUST remain readable after restart even when provider launch state is reconstructed lazily and the global engine configuration has no single `home_dir`.

#### Scenario: force refresh finds a managed Kimi session

- **WHEN** a managed Kimi session was created before restart
- **AND** its history remains under the app-local provider home
- **AND** the user invokes force refresh
- **THEN** the returned session list MUST contain that session
- **AND** the session MUST retain its Kimi engine identity

#### Scenario: explicit custom home remains isolated

- **WHEN** a Kimi history API receives an explicit custom home
- **THEN** it MUST scan only that home
- **AND** it MUST NOT implicitly scan unrelated managed provider homes
