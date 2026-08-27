# unified-engine-model-selection Specification Delta

## ADDED Requirements

### Requirement: Product Model Catalog SHALL Project API Protocol Compatibility

Doge MUST source engines from its local registry, treat the active product's upstream catalog as the
entitlement ceiling, normalize every model row to canonical managed Provider API protocols, and derive
each engine's rows from the engine-to-protocol capability mapping. It MUST NOT require a Doge release to
enumerate every model id, and MUST NOT treat CLI process protocol as managed Provider API protocol.

#### Scenario: Codex and Kimi consume the OpenAI-compatible catalog

- **GIVEN** an upstream model row supports the canonical `openai` API protocol
- **WHEN** Doge renders Product model choices
- **THEN** the row SHALL appear under both Codex and Kimi in the same upstream order
- **AND** selecting a Kimi-family runtime model under Codex SHALL preserve and send its exact runtime id

#### Scenario: Claude consumes the Anthropic Messages catalog

- **GIVEN** an upstream model row supports the canonical `anthropic` API protocol
- **WHEN** Doge renders Product model choices
- **THEN** the row SHALL appear under Claude
- **AND** it SHALL appear under Codex/Kimi only when the same row also supports `openai`

#### Scenario: Upstream publishes explicit protocol metadata

- **WHEN** `/v1/models` returns a valid `api_protocols`, `supported_protocols`, or `protocols` list
- **THEN** Native SHALL normalize known aliases to `openai` and/or `anthropic`
- **AND** explicit metadata SHALL be authoritative
- **AND** an explicit list with no known protocol SHALL fail closed without family fallback

#### Scenario: Legacy upstream publishes engine compatibility

- **WHEN** `/v1/models` returns legacy `compatible_engines` without explicit protocol metadata
- **THEN** Native SHALL map `codex|kimi` evidence to `openai`
- **AND** SHALL map `claude|claude-code` evidence to `anthropic`
- **AND** the Renderer SHALL filter by canonical protocol rather than preserving a per-engine model list

#### Scenario: Compatibility metadata is absent

- **WHEN** a valid conversation model lacks protocol and legacy engine metadata
- **THEN** the documented known-family fallback SHALL map GPT/OpenAI and Kimi/Moonshot/K3 to `openai`
- **AND** Claude/Anthropic SHALL map to `anthropic`
- **AND** an existing verified cross-protocol Doubao/Ark row MAY map to both protocols
- **AND** unknown families SHALL fail closed

#### Scenario: User switches engine

- **WHEN** the user switches between Codex and Kimi
- **THEN** the currently selected OpenAI-compatible model SHALL remain selected
- **AND** Doge SHALL NOT replace it merely because the local CLI engine changed
- **WHEN** the user switches to Claude and the model lacks `anthropic`
- **THEN** Doge SHALL atomically select the first Anthropic-compatible upstream row or fail closed when
  the intersection is empty
