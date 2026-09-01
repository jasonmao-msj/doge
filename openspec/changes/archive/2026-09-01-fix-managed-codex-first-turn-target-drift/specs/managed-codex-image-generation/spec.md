## MODIFIED Requirements

### Requirement: Managed Codex MUST Use A Version-Matched Non-Lite Catalog For Image-Capable GPT-5.6 Models

Doge SHALL derive the managed custom-provider model catalog from the exact Codex binary being launched, SHALL disable Responses Lite only for verified GPT-5.6 Product models, and SHALL keep the managed configuration fallback on an allowed image-capable GPT-5.6 model.

#### Scenario: existing managed configuration predates Product-safe fallback

- **WHEN** an existing install has managed configuration revision 2 with `model/review_model = gpt-5.5`
- **THEN** exact Codex prepare MUST migrate it to the current revision
- **AND** both fallback fields MUST become `gpt-5.6-sol`
- **AND** unrelated local/custom providers and Kimi's independent default MUST remain unchanged

#### Scenario: managed Codex launches an image-capable GPT-5.6 model

- **GIVEN** the frozen target uses `providerProfileId=doge-token-matrix`
- **WHEN** Doge prepares the exact Codex binary and isolated provider home
- **THEN** Doge SHALL export that binary's bundled model catalog
- **AND** exact entries `gpt-5.6-sol`、`gpt-5.6-terra` and `gpt-5.6-luna` SHALL use `use_responses_lite=false`
- **AND** all unrelated catalog fields and entries SHALL remain semantically unchanged
- **AND** the requested Turn model MUST remain the frozen Product target

#### Scenario: The Codex binary changes

- **WHEN** a later app or external Codex binary is selected for the same managed provider
- **THEN** Doge SHALL materialize the effective catalog from that selected binary before launch
- **AND** Doge MUST NOT reuse a hardcoded full catalog from a previous Codex version

#### Scenario: A local or custom provider launches Codex

- **WHEN** `providerProfileId` is absent or is not `doge-token-matrix`
- **THEN** Doge SHALL preserve the existing provider-owned catalog behavior
- **AND** Doge MUST NOT inject the managed `model_catalog_json` override

### Requirement: Managed Codex Image Generation MUST Be Proven By Native Image Evidence

Image generation success SHALL require a native image output item and renderable payload; assistant prose alone is not authoritative evidence. A Product model shown in Composer MUST be the same runtime model recorded in the corresponding Codex `turn_context`.

#### Scenario: UI displays Sol for an immediate first image turn

- **WHEN** Composer displays `gpt-5.6-sol` and the user sends an image-generation request immediately after Native session creation
- **THEN** Codex `turn_context.model` MUST equal `gpt-5.6-sol`
- **AND** success MUST contain completed `image_generation_call` with non-empty image result
- **AND** Doge MUST NOT silently dispatch `gpt-5.5`

#### Scenario: User asks managed Codex to generate an image

- **GIVEN** Product policy allows image generation and token2api hosted bridge is enabled
- **WHEN** a non-Lite managed Codex turn requests an image
- **THEN** the upstream response SHALL contain a completed `image_generation_call` with a non-empty image result
- **AND** Doge SHALL project the existing generated-image artifact beside the triggering user turn

#### Scenario: Model only claims that an image was generated

- **WHEN** the turn contains assistant text such as “已生成” but no native image output item
- **THEN** acceptance SHALL treat the image operation as not completed
- **AND** Doge MUST NOT fabricate an image card or report image generation success

#### Scenario: Shared Codex receives a completed image result

- **WHEN** an owned Shared Codex Turn's exact provider-scoped native rollout records completed `image_generation_call` with a valid non-empty image result for the same runtime turn id
- **THEN** Doge MUST persist the decoded image outside Shared SQLite using content-addressed atomic storage
- **AND** canonical `turnCommitted.artifactRefs` MUST contain a compact image reference to that stable local artifact
- **AND** Shared Projection MUST render a `generatedImage` item in live and restored history
- **AND** an already-open Shared timeline MUST reconcile canonical projection after durable terminal commit without requiring manual reopen
- **AND** assistant prose alone MUST NOT substitute for missing native image evidence
- **AND** an image from an older Turn of the same native session MUST NOT be attached to the current Turn
- **AND** local media loading MUST allow only the canonical managed generated-image root in addition to existing preview roots

#### Scenario: Shared image result is unsafe to materialize

- **WHEN** the raw image result is invalid, unsupported, or exceeds the bounded payload limit
- **THEN** Doge MUST NOT create a completed canonical image artifact
- **AND** MUST NOT persist the raw Base64 in Shared SQLite or frontend durable state

#### Scenario: The user reopens the conversation

- **WHEN** the native history contains the completed image output
- **THEN** the existing Codex history projection SHALL restore the same generated-image artifact
- **AND** the preview SHALL preserve completed/degraded semantics from the canonical image payload

#### Scenario: existing product user upgrades Doge

- **GIVEN** an authenticated existing user already has managed provider config and Shared Sessions
- **WHEN** the user installs the release containing this change
- **THEN** the next managed Shared Codex Turn MUST use current revision config and generated-image reconciliation automatically
- **AND** MUST NOT require config deletion, re-login, or Shared Session recreation
- **AND** a historical pre-upgrade Turn without native image artifact evidence MUST NOT receive a guessed image backfill
