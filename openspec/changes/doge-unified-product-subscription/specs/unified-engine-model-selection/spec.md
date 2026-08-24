# unified-engine-model-selection Specification

## ADDED Requirements

### Requirement: Product Model Selection SHALL Be Engine-Compatible

Doge MUST source engines from its local registry, treat the active product's upstream catalog as the entitlement ceiling, and derive each engine's rows from upstream `compatible_engines` metadata when present. It MUST NOT require a Doge release to enumerate every model id.

#### Scenario: Product Home initializes its first target

- **WHEN** a ready user opens Home before making a picker selection
- **THEN** the target engine SHALL be Codex
- **AND** the target model SHALL be the first Codex-compatible upstream row
- **AND** user selection during that Home lifecycle SHALL replace the initial target without changing provider authority

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

#### Scenario: Administrator narrows the product model visibility upstream

- **GIVEN** the `Doge APP` Composite group owns a custom `/v1/models` display list
- **WHEN** the administrator changes that list to expose only currently callable models
- **THEN** Doge SHALL consume the refreshed upstream response without a client model-id allowlist or release
- **AND** all signed-in clients SHALL converge through the existing focus/visibility/manual catalog refresh contract

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

#### Scenario: Claude first send consumes the frozen product target

- **GIVEN** the Composer has frozen a Claude product target with `providerProfileId=doge-token-matrix`
- **WHEN** the first send creates the pending Native Claude Session
- **THEN** the thread binding and Claude launch request SHALL retain the managed Provider identity, runtime model and optional reasoning effort from that target
- **AND** a Home/Kanban wrapper SHALL forward the frozen target through the immediate first send even when reducer state has not yet published the pending thread binding
- **AND** ambient `~/.claude/settings.json` Provider credentials SHALL NOT take over the new Session

#### Scenario: Existing selection points to a local profile

- **GIVEN** a persisted create-session or Shared selection uses a local/disk profile
- **WHEN** the product-ready composer hydrates that selection
- **THEN** Doge SHALL repair the selection to the same supported engine and model with the managed profile before it can be sent
- **AND** the product picker SHALL NOT expose a configuration/profile selector

#### Scenario: Existing installation contains an older Doge projection

- **GIVEN** the user upgrades Doge and the stable `doge-token-matrix` entry is missing the current `managedRevision` or contains legacy endpoint, model or secret fields
- **WHEN** the authenticated product gate prepares Codex, Claude and Kimi
- **THEN** Doge SHALL replace each stale same-id managed entry with the current deterministic projection before mounting the app
- **AND** unrelated local/custom provider entries SHALL remain intact
- **AND** a stale projection SHALL fail closed rather than be treated as ready

#### Scenario: User runs the same CLI outside Doge

- **GIVEN** Doge has prepared isolated managed homes/settings for product sessions
- **WHEN** the user directly launches Codex, Claude or Kimi from a terminal
- **THEN** that process SHALL continue to read the user's own global CLI configuration
- **AND** Doge SHALL NOT persist its managed endpoint or credential into the user's global CLI home

#### Scenario: Product-ready settings show local configuration

- **GIVEN** the Doge product entitlement is ready
- **WHEN** the user opens Engine Management for Codex, Claude or Kimi
- **THEN** local/official activation SHALL be visibly locked and SHALL NOT expose a use/cancel action
- **AND** editing the user's global local file MAY remain available for terminal direct usage
- **AND** editing that file SHALL NOT change the managed product execution target

#### Scenario: User switches engine or model

- **WHEN** the user changes either product selection
- **THEN** the committed target SHALL retain `doge-token-matrix`
- **AND** neither engine nor model switching SHALL reintroduce local/disk configuration

#### Scenario: Native conversation switches engine and model before Provider Continuation

- **GIVEN** an existing Native conversation is bound to one managed engine/model
- **WHEN** the user opens the product picker and selects another engine
- **THEN** Doge SHALL update only the picker draft and SHALL NOT prepare a Provider Continuation yet
- **WHEN** the user selects a compatible model for that draft engine
- **THEN** Doge SHALL submit exactly one complete target containing that engine, selected model and `doge-token-matrix`
- **AND** the target Native thread SHALL start with that exact runtime model instead of the source model or a CLI default

#### Scenario: Product-ready user creates a session from the Sidebar

- **GIVEN** the product entitlement is ready
- **WHEN** the user opens the Sidebar new-session menu
- **THEN** Claude, Codex and Kimi SHALL be direct leaf actions without a Provider submenu
- **AND** each action SHALL create the session with `providerProfileId=doge-token-matrix` and managed Provider metadata
- **AND** remembered local/custom Provider preferences SHALL NOT affect that product session

#### Scenario: Shared conversation renders a turn target label

- **WHEN** Shared renders an assistant turn with an immutable execution target snapshot
- **THEN** the visible label SHALL contain engine, model and optional reasoning effort
- **AND** the provider profile display name SHALL remain an internal binding detail and SHALL NOT appear in the label

### Requirement: Terminal Provider Failures SHALL Remain Visible After History Recovery

Doge MUST preserve an authoritative terminal provider failure as readable conversation history. A history hydrate or provider-continuation reconciliation MUST NOT erase the only user-visible failure diagnostic.

#### Scenario: Codex turn fails before producing an assistant message

- **GIVEN** realtime handling has received a terminal Codex failure and displayed its diagnostic
- **AND** the Codex rollout records a failed `task_complete` with no final assistant message
- **WHEN** Doge reloads or reconciles the local Codex history
- **THEN** the recovered conversation SHALL include one readable assistant diagnostic containing the terminal error
- **AND** a successful `task_complete` SHALL NOT synthesize an error message

#### Scenario: Claude emits a structured API rejection without process exit

- **GIVEN** a managed Claude turn or Provider Continuation receives an `assistant` stream event with camelCase/snake_case API-error evidence, or a `result` event with `is_error=true`
- **WHEN** the Claude process keeps stdout open and does not emit a later `result`
- **THEN** Doge SHALL normalize the structured rejection to one terminal `TurnError`
- **AND** SHALL stop waiting for EOF, terminate the exact process group, and settle the caller with the Provider error
- **AND** a Provider Continuation Dialog SHALL leave its `running` state instead of remaining on context delivery indefinitely

### Requirement: Doge Anthropic Pricing SHALL Cover The Initial Claude Matrix

The single-owner `Doge 统一定价` channel MUST allow the initial verified Claude model and the public Doubao alias on the Anthropic Messages path. Pricing configuration MUST reuse official Claude rates and MUST NOT invent per-token rates for the Doubao Coding Plan.

#### Scenario: Claude engine uses a verified Claude model

- **WHEN** the managed Claude engine sends `claude-sonnet-4-6` through Messages
- **THEN** channel pricing SHALL use the official `3/15/3.75/0.3 $/MTok` input/output/cache-write/cache-read values
- **AND** the request SHALL be eligible for the bound Claude account pool

#### Scenario: Claude engine uses Opus 4.8

- **WHEN** the managed Claude engine sends `claude-opus-4-8` through Messages
- **THEN** `Doge 统一定价` SHALL reuse the official `claude-opus-5 + claude-opus-4-8` rule
- **AND** channel pricing SHALL use `5/25/6.25/0.5 $/MTok` input/output/cache-write/cache-read values
- **AND** the request SHALL remain on the Doge managed Provider instead of inheriting an ambient OpenRouter profile

#### Scenario: Claude engine uses Doubao

- **WHEN** the managed Claude engine sends the public model id `豆包` through Messages
- **THEN** the Anthropic channel allowlist SHALL match `ark-code-latest + 豆包`
- **AND** token prices SHALL remain unset because the upstream Coding Plan is subscription/quota based

### Requirement: Doge OpenAI Pricing SHALL Cover The Released GPT Matrix

The single-owner `Doge 统一定价` OpenAI rule MUST allow every GPT alias released by the Doge product catalog.

#### Scenario: Codex sends Sol or Terra

- **WHEN** managed Codex sends `gpt-5.6-sol` or `gpt-5.6-terra` through Responses
- **THEN** channel pricing SHALL match the same current GPT price rule used by `gpt-5.6-luna`
- **AND** Composite SHALL retain the requested model identity
- **AND** the request SHALL reach the bound OpenAI account pool instead of returning a pricing allowlist 503
