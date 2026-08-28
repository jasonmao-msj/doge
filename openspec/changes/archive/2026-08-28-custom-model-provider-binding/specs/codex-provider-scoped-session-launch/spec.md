## ADDED Requirements

### Requirement: Codex Custom Model Manager MUST Be A First-Class Writer Of Provider Custom Models

In addition to the Codex provider edit dialog, the shared custom model manager MUST be allowed to create, update, rebind, and delete entries in a managed Codex provider’s `customModels`. Writes from the model manager MUST update the composer-visible Codex custom model catalog without requiring an app restart and MUST NOT switch or restart the active Codex runtime.

#### Scenario: model manager save updates provider customModels
- **WHEN** the user saves a Codex custom model in the custom model manager bound to managed provider A
- **THEN** provider A’s persisted `customModels` MUST include that model
- **AND** the Codex model selector catalog MUST reflect the addition without an app restart
- **AND** existing Codex conversations MUST keep their thread-bound provider runtime

#### Scenario: model manager delete updates provider customModels
- **WHEN** the user deletes a Codex custom model that is owned by managed provider A from the custom model manager
- **THEN** provider A’s `customModels` MUST no longer contain that model id
- **AND** the Codex model selector catalog MUST drop that custom model entry
