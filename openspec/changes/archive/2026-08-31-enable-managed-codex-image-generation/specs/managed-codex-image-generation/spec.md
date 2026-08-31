## ADDED Requirements

### Requirement: Managed Codex MUST Use A Version-Matched Non-Lite Catalog For Image-Capable GPT-5.6 Models

Doge SHALL derive the managed custom-provider model catalog from the exact Codex binary being launched and SHALL disable Responses Lite only for the verified GPT-5.6 Product models before any managed native side effect.

#### Scenario: Managed Codex launches an image-capable GPT-5.6 model
- **GIVEN** the frozen target uses `providerProfileId=doge-token-matrix`
- **WHEN** Doge prepares the exact Codex binary and isolated provider home
- **THEN** Doge SHALL export that binary's bundled model catalog
- **AND** exact entries `gpt-5.6-sol`、`gpt-5.6-terra` and `gpt-5.6-luna` SHALL have `use_responses_lite=false` in the effective launch catalog
- **AND** all unrelated catalog fields and entries SHALL remain semantically unchanged

#### Scenario: The Codex binary changes
- **WHEN** a later app or external Codex binary is selected for the same managed provider
- **THEN** Doge SHALL materialize the effective catalog from that selected binary before launch
- **AND** Doge MUST NOT reuse a hardcoded full catalog from a previous Codex version

#### Scenario: A local or custom provider launches Codex
- **WHEN** `providerProfileId` is absent or is not `doge-token-matrix`
- **THEN** Doge SHALL preserve the existing provider-owned catalog behavior
- **AND** Doge MUST NOT inject the managed `model_catalog_json` override

### Requirement: Managed Catalog Materialization MUST Fail Closed Before Session Side Effects

The managed catalog export、validation and atomic write SHALL complete before Codex creates or resumes a Session、Binding or Turn.

#### Scenario: Bundled catalog export succeeds
- **WHEN** `codex debug models --bundled` exits successfully with a bounded valid catalog
- **THEN** Doge SHALL validate all three exact target entries and atomically write the managed catalog artifact
- **AND** the app-server launch SHALL receive its absolute path through `model_catalog_json`

#### Scenario: Export or validation fails
- **WHEN** the command fails、times out、exceeds the output bound or returns malformed/missing/duplicate target entries
- **THEN** managed Codex activation SHALL fail with a diagnostic error before native side effects
- **AND** Doge MUST NOT silently launch with Responses Lite or mutate user global Codex config

#### Scenario: The same managed runtime is prepared repeatedly
- **WHEN** Doge prepares the same binary/provider home more than once
- **THEN** the effective catalog SHALL remain equivalent
- **AND** replacement SHALL be atomic with no partial artifact visible to Codex

### Requirement: Managed Codex Image Generation MUST Be Proven By Native Image Evidence

Image generation success SHALL require a native image output item and renderable payload; assistant prose alone is not authoritative evidence.

#### Scenario: User asks managed Codex to generate an image
- **GIVEN** Product policy allows image generation and token2api hosted bridge is enabled
- **WHEN** a non-Lite managed Codex turn requests an image
- **THEN** the upstream response SHALL contain a completed `image_generation_call` with a non-empty image result
- **AND** Doge SHALL project the existing generated-image artifact beside the triggering user turn

#### Scenario: Model only claims that an image was generated
- **WHEN** the turn contains assistant text such as “已生成” but no native image output item
- **THEN** acceptance SHALL treat the image operation as not completed
- **AND** Doge MUST NOT fabricate an image card or report image generation success

#### Scenario: The user reopens the conversation
- **WHEN** the native history contains the completed image output
- **THEN** the existing Codex history projection SHALL restore the same generated-image artifact
- **AND** the preview SHALL preserve completed/degraded semantics from the canonical image payload
