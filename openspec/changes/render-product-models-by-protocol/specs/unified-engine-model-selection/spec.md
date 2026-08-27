# unified-engine-model-selection Specification Delta

## ADDED Requirements

### Requirement: Product Model Catalog SHALL Project API Protocol Compatibility

Doge MUST source engines from its local registry, treat the active product's upstream catalog as the
entitlement ceiling, normalize every model row to canonical managed Provider API protocols, and derive
each engine's rows from the engine-to-protocol capability mapping. It MUST NOT require a Doge release to
enumerate every model id, and MUST NOT treat CLI process protocol as managed Provider API protocol.

#### Scenario: Codex and Kimi use different OpenAI endpoint protocols

- **GIVEN** an upstream model row supports `openai-responses`
- **WHEN** Doge renders Product model choices
- **THEN** the row SHALL appear under Codex
- **AND** SHALL appear under Kimi only when the row also supports `openai-chat-completions`
- **GIVEN** an upstream model row supports only `openai-chat-completions`
- **THEN** the row SHALL appear under Kimi and MUST NOT appear under Codex

#### Scenario: Claude consumes the Anthropic Messages catalog

- **GIVEN** an upstream model row supports the canonical `anthropic-messages` API protocol
- **WHEN** Doge renders Product model choices
- **THEN** the row SHALL appear under Claude
- **AND** it SHALL appear under Codex/Kimi only when the same row also supports their exact endpoint protocol

#### Scenario: Upstream publishes explicit protocol metadata

- **WHEN** `/v1/models` returns a valid `api_protocols`, `supported_protocols`, or `protocols` list
- **THEN** Native SHALL normalize known aliases to `openai-responses`,
  `openai-chat-completions`, and/or `anthropic-messages`
- **AND** explicit metadata SHALL be authoritative
- **AND** an explicit list with no known protocol SHALL fail closed without family fallback

#### Scenario: Legacy upstream publishes engine compatibility

- **WHEN** `/v1/models` returns legacy `compatible_engines` without explicit protocol metadata
- **THEN** Native SHALL map `codex` evidence to `openai-responses`
- **AND** SHALL map `kimi` evidence to `openai-chat-completions`
- **AND** SHALL map `claude|claude-code` evidence to `anthropic-messages`
- **AND** the Renderer SHALL filter by canonical protocol rather than preserving a per-engine model list

#### Scenario: Compatibility metadata is absent

- **WHEN** a valid conversation model lacks protocol and legacy engine metadata
- **THEN** the documented known-family fallback SHALL map GPT/OpenAI to Responses + Chat Completions
- **AND** Kimi/Moonshot/K3 SHALL map to Responses + Chat Completions after both production routes pass
  exact endpoint probes
- **AND** Claude/Anthropic SHALL map only to Anthropic Messages
- **AND** an existing verified cross-protocol Doubao/Ark row MAY map to all three endpoint protocols
- **AND** unknown families SHALL fail closed

#### Scenario: User switches engine

- **WHEN** the user switches between Codex and Kimi
- **THEN** the current model SHALL remain selected only when it supports both Responses and Chat Completions
- **AND** otherwise Doge SHALL atomically select the first row compatible with the destination endpoint
- **WHEN** the user switches to Claude and the model lacks `anthropic-messages`
- **THEN** Doge SHALL atomically select the first Anthropic-Messages-compatible upstream row or fail
  closed when the intersection is empty

#### Scenario: K3 and Kimi models run through Codex Responses

- **GIVEN** production Composite routes `k3*` and `kimi*` target Kimi through Responses
- **AND** exact managed-key Responses probes for `k3`, `k3-256k`, and `kimi-for-coding` succeed
- **WHEN** the user selects Codex
- **THEN** those Kimi-family rows SHALL remain visible and selectable
- **AND** the frozen Codex target SHALL preserve the selected runtime model id
