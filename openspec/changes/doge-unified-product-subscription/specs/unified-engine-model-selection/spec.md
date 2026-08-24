# unified-engine-model-selection Specification

## ADDED Requirements

### Requirement: Product Model Selection SHALL Be Engine-Compatible

Doge MUST source engines from its local registry, treat the active product's upstream catalog as the entitlement ceiling, and derive each engine's rows from upstream `compatible_engines` metadata when present. It MUST NOT require a Doge release to enumerate every model id.

#### Scenario: User switches engine

- **WHEN** the user selects another installed Doge engine
- **THEN** Doge SHALL filter the current upstream catalog through each row's compatible engine set
- **AND** the selected model SHALL remain unchanged only when it is compatible with the next engine
- **AND** otherwise Doge SHALL atomically select the first compatible upstream model for that engine
- **AND** it SHALL NOT produce a partial target or silently fall back to a local/default model when the intersection is empty

#### Scenario: User switches model

- **WHEN** the user selects another product model
- **THEN** the selected engine SHALL remain unchanged
- **AND** the selection SHALL take effect immediately without closing the picker

#### Scenario: Upstream adds a conversation model

- **WHEN** a later `/v1/models` response adds a valid conversation-capable row
- **THEN** Doge SHALL publish it without requiring a client model-id allowlist update
- **AND** upstream `compatible_engines` SHALL restrict the engines when provided
- **AND** absent compatibility metadata SHALL use the documented family fallback for GPT/Claude/Kimi/Doubao while unknown families fail closed

### Requirement: Composer SHALL Use A Native Side Panel For Target Selection

The product-managed model entry MUST open a right-side Doge surface containing compact engine single-select controls followed by a searchable, vendor-grouped model single-select list.

#### Scenario: Picker is open

- **WHEN** the user opens engine/model selection
- **THEN** Doge SHALL slide a full-height right panel over the current surface rather than displaying nested floating submenus
- **AND** engine options SHALL show their complete display names in a compact row layout without separate card containers
- **AND** product models SHALL show upstream `display_name`, be grouped and stably ordered by presentation vendor, and retain upstream catalog order within each vendor
- **AND** every engine and model SHALL show its presentation icon when available
- **AND** the composer SHALL show engine icon, model icon and model display name for the committed target

#### Scenario: User searches the grouped model catalog

- **WHEN** the user enters a model search query
- **THEN** Doge SHALL search only the selected engine's compatible model rows
- **AND** it SHALL preserve vendor headings only for groups containing matching models
- **AND** vendor grouping SHALL remain presentation-only and MUST NOT add or remove rows beyond the compatibility intersection

### Requirement: Model Entitlement SHALL Come From The Managed Composite Catalog

Doge MUST NOT invent product model availability from local presentation metadata.

#### Scenario: Catalog returns a new model family

- **WHEN** the managed `/v1/models` response includes a previously unseen model id
- **THEN** Native SHALL validate and publish the row without requiring a Doge model-id allowlist update
- **AND** the row SHALL be limited by upstream compatibility/capability metadata when present
- **AND** the renderer MUST NOT create entitlement for a model absent from the upstream response

#### Scenario: Product row separates display and runtime identity

- **GIVEN** the managed product catalog contains `display_name=豆包` and a callable `model=ark-code-latest`
- **WHEN** the user selects that catalog entry
- **THEN** Doge SHALL render only the display name as the primary user label
- **AND** Doge SHALL preserve the upstream entry id as `modelCatalogEntryId`
- **AND** Doge SHALL send `ark-code-latest` as `ExecutionTarget.model`

#### Scenario: Upstream hides account-private model mapping

- **GIVEN** `/v1/models` returns `id=豆包, display_name=豆包` without a callable `model` field
- **WHEN** Doge composes the target
- **THEN** `ExecutionTarget.model` SHALL use the public id `豆包`
- **AND** Doge SHALL NOT copy or guess the admin-only mapping target `ark-code-latest`
- **AND** token2api SHALL remain responsible for resolving its private account mapping

### Requirement: Product Model Catalog SHALL Refresh Without Blank-State Regression

Doge SHALL re-read the managed `/v1/models` catalog while a product session remains ready and preserve last-known-good rows during slow or failed refreshes.

#### Scenario: Upstream changes the model list

- **WHEN** the ready App regains focus, becomes visible, reaches its bounded refresh interval, or the user requests refresh
- **THEN** Doge SHALL coalesce the read through one in-flight owner
- **AND** a successful response SHALL update Home, Shared, Account Center and the open picker from one snapshot
- **AND** a removed selected model SHALL be atomically repaired before the next send

#### Scenario: Refresh is slow or fails

- **WHEN** the refresh request is pending or returns a typed failure
- **THEN** existing models SHALL remain visible and selectable
- **AND** the picker SHALL expose scoped refreshing/stale feedback and retry
- **AND** profile, entitlement, conversation and other account details SHALL remain usable

### Requirement: Product Flow SHALL Always Use The Doge Managed Provider

When the Doge product entitlement is ready, provider configuration MUST be an internal runtime binding rather than a user-selectable dimension. Every resolved product execution target MUST use `providerProfileId=doge-token-matrix` and `providerProfileSource=managed`.

#### Scenario: User starts a new conversation without opening the picker

- **GIVEN** the Doge product entitlement and managed credential are ready
- **WHEN** the composer initializes its default engine and model
- **THEN** the new-session target SHALL explicitly bind `doge-token-matrix`
- **AND** sending MUST NOT inherit the active local/disk profile

#### Scenario: Existing selection points to a local profile

- **GIVEN** a persisted create-session or Shared selection uses a local/disk profile
- **WHEN** the product-ready composer hydrates that selection
- **THEN** Doge SHALL repair the selection to the same supported engine and model with the managed profile before it can be sent
- **AND** the product picker SHALL NOT expose a configuration/profile selector

#### Scenario: User switches engine or model

- **WHEN** the user changes either product selection
- **THEN** the committed target SHALL retain `doge-token-matrix`
- **AND** neither engine nor model switching SHALL reintroduce local/disk configuration

### Requirement: Terminal Provider Failures SHALL Remain Visible After History Recovery

Doge MUST preserve an authoritative terminal provider failure as readable conversation history. A history hydrate or provider-continuation reconciliation MUST NOT erase the only user-visible failure diagnostic.

#### Scenario: Codex turn fails before producing an assistant message

- **GIVEN** realtime handling has received a terminal Codex failure and displayed its diagnostic
- **AND** the Codex rollout records a failed `task_complete` with no final assistant message
- **WHEN** Doge reloads or reconciles the local Codex history
- **THEN** the recovered conversation SHALL include one readable assistant diagnostic containing the terminal error
- **AND** a successful `task_complete` SHALL NOT synthesize an error message
