## ADDED Requirements

### Requirement: Provider-owned Codex models MUST preserve runtime capability metadata without fabricated facts

Codex discovery/catalog composition MUST retain provider/runtime reasoning metadata and may fill only missing facts from an authoritative runtime-model identity match. It MUST NOT overwrite provider-owned values or grant reasoning capability to an unmatched provider-only model.

#### Scenario: Runtime discovery includes reasoning metadata
- **WHEN** a provider model/list response includes supported reasoning efforts
- **THEN** the composed picker row MUST preserve those efforts and runtime model identity

#### Scenario: Provider-only model has no authoritative match
- **WHEN** a provider model does not match an authoritative Codex catalog identity
- **THEN** the row MUST remain capability-neutral unless the provider itself supplied metadata

### Requirement: Unknown Codex context window MUST remain unknown

Codex usage events and frontend legacy normalization MUST pass through a missing model context window as `None/null`. They MUST NOT substitute `200000` or any other guessed value.

#### Scenario: Relay reports tokens without a context window
- **WHEN** Codex usage contains input/output tokens but no model context window
- **THEN** the token view MUST show the existing unreported/unknown state
- **AND** it MUST NOT calculate a percentage from a fabricated denominator

#### Scenario: Runtime reports a context window
- **WHEN** usage contains a positive context-window value
- **THEN** that exact value MUST be preserved through backend and frontend mapping
