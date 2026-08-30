## ADDED Requirements

### Requirement: Codex provider environment references MUST resolve in GUI and daemon launch contexts

When a managed Codex profile refers to an API credential through `env_key`, the Rust runtime owner MUST resolve the variable for the exact provider launch in both desktop GUI and doge daemon modes. Resolution MUST NOT fall back to disk/default provider, persist the secret in business config, or expose it to renderer/log output.

#### Scenario: macOS GUI lacks login-shell environment propagation
- **WHEN** doge is launched from Dock/Launchpad and the selected managed profile declares `env_key`
- **THEN** the runtime MUST resolve the variable through the bounded provider environment resolver before spawning Codex
- **AND** the child MUST receive the value only in its process environment

#### Scenario: Required variable is unavailable
- **WHEN** the selected profile requires an environment variable that cannot be resolved
- **THEN** launch MUST fail with a provider-scoped, redacted error
- **AND** it MUST NOT use disk/default credentials

#### Scenario: Daemon launches a Codex configuration with env references
- **WHEN** doge daemon launches its currently supported Codex configuration and that configuration declares `env_key`
- **THEN** it MUST use the same bounded normalization and resolution helper as desktop
- **AND** the daemon's existing explicit managed-provider support ceiling MUST remain unchanged rather than silently routing a managed id to disk
