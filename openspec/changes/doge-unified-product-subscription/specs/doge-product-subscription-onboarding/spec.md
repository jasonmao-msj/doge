# doge-product-subscription-onboarding Specification

## ADDED Requirements

### Requirement: Product Entitlement SHALL Be The App Access Authority

Doge MUST treat an active subscription bound to a server-advertised Composite Doge product group as the sole commercial authority for mounting AppShell.

#### Scenario: Authenticated account has no active Doge product subscription

- **WHEN** account bootstrap succeeds but no active subscription matches any currently saleable Doge Composite product group
- **THEN** Doge SHALL render a full-screen subscription Gate and MUST NOT mount workspace, conversation, settings, or managed engine runtime surfaces
- **AND** the Gate SHALL still allow the user to log out and switch account

#### Scenario: Active product entitlement is restored

- **WHEN** subscription authority reports a matching active Doge product subscription
- **THEN** Doge SHALL prepare one managed Composite credential and model catalog before mounting AppShell
- **AND** it MUST NOT require the user to select an engine or API key

### Requirement: Product Checkout SHALL Use Upstream-Owned Catalog Fields

The Gate MUST render plan and checkout facts from token2api and MUST NOT hardcode price, validity, description, payment method, or product model names.

#### Scenario: Standard payment method omits an optional display name

- **GIVEN** token2api returns a valid payment method id and currency with an empty `display_name`
- **WHEN** Doge projects and renders the checkout methods
- **THEN** Doge SHALL retain the method and use a localized label derived from its canonical payment type
- **AND** an empty optional `display_name` SHALL NOT make the payment method unavailable

#### Scenario: Product plan is offered

- **WHEN** token2api returns one or more saleable Composite plans
- **THEN** Doge SHALL show each plan using its server-owned name, description, price, currency and validity
- **AND** each plan SHALL use a structured card with a plan header, Doge engine row, upstream feature/model row and a full-width subscribe action
- **AND** the whole card SHALL NOT collapse into one unstructured text button
- **AND** payment completion SHALL be confirmed by authoritative subscription refresh before AppShell unlocks

#### Scenario: Payment is complete before entitlement propagation settles

- **WHEN** checkout authority reports `paid` but subscription summary still reports no matching active Composite entitlement
- **THEN** Doge SHALL enter a visible `fulfilling` state and force-refresh catalog with bounded backoff
- **AND** it SHALL retain a credential-free paid fulfillment checkpoint across App restart
- **AND** it SHALL NOT return to the plan purchase surface or create another order
- **AND** the checkpoint SHALL clear only after active entitlement is observed and managed preparation succeeds

### Requirement: Managed Product Access SHALL Be Secret-Safe And Idempotent

Doge MUST scope managed product access to account, device and Composite group, and all retries MUST converge on one usable credential without exposing its secret to renderer or logs.

#### Scenario: Preparation is repeated

- **WHEN** startup, payment reconciliation, retry, or account refresh invokes preparation more than once
- **THEN** Native SHALL reuse or safely refresh the same managed binding
- **AND** repeated calls MUST NOT create an unbounded number of API keys or remote requests

#### Scenario: Authority rate-limits preparation

- **WHEN** token2api returns HTTP 429 with a retry interval
- **THEN** Doge SHALL present an actionable cooldown state using `retryAfterMs`
- **AND** automatic and manual retries MUST remain disabled until the cooldown expires

#### Scenario: Managed engine preparation fails

- **WHEN** Native returns a recoverable managed engine preparation error
- **THEN** the full-screen Gate SHALL show one concise, cause-specific sentence and one retry action
- **AND** it SHALL NOT repeat the same failure through a generic heading, inline warning, or decorative alert icon

#### Scenario: Legacy Kimi registry contains a persisted secret field

- **WHEN** managed Kimi preparation replaces an existing Doge provider entry containing `apiKey`, `api_key`, `token` or `secret`
- **THEN** the resulting Doge registry SHALL be secret-free JSON and SHALL pass the Kimi-specific JSON verifier
- **AND** the verifier SHALL NOT parse the Kimi registry as Codex TOML
- **AND** the raw credential SHALL remain only in the selected durable vault and owner-only launch `config.toml`

### Requirement: Product-Ready Home Sends SHALL Use The Managed Product Target

When product entitlement and preparation are ready, Home/new-session sends MUST bind the selected engine and model to `doge-token-matrix`; display catalog identity MUST NOT replace the CLI runtime model.

#### Scenario: User selects a Kimi fallback catalog model

- **GIVEN** the provider picker exposes `kimi-code/kimi-for-coding` while the product model authority exposes `kimi-for-coding`
- **WHEN** the user selects that model and sends from Home
- **THEN** the create-session target SHALL retain the namespaced catalog entry for display/persistence and send raw runtime model `kimi-for-coding`
- **AND** provider profile id/source SHALL be `doge-token-matrix/managed`
- **AND** the session MUST NOT fall back to the previously selected global model

#### Scenario: Provider picker emits a repairable partial product target

- **WHEN** a product-ready engine/model selection omits a provider display snapshot or uses a catalog namespace alias
- **THEN** the product target resolver SHALL normalize and complete it before the final resolved-target guard
- **AND** non-product flows SHALL continue to reject incomplete targets without fabrication

### Requirement: Product Engines SHALL Consume A Dynamic Compatible Catalog

For an active prepared product entitlement, Doge SHALL consume the refreshable upstream product model catalog and its optional engine compatibility metadata. Provider configuration SHALL remain a hidden managed implementation detail.

#### Scenario: Product preparation starts on a fresh device

- **WHEN** the account has an active Doge subscription but one or more product engines are not yet executable
- **THEN** Doge SHALL resolve Codex and Claude Code through the verified account toolchain
- **AND** it SHALL install Kimi CLI through the existing typed installer only when Kimi is absent
- **AND** provider configuration and AppShell ready MUST wait for post-provision verification
- **AND** an install/toolchain failure SHALL remain on the recoverable preparation surface

#### Scenario: Product picker opens on Home

- **WHEN** the user opens the model trigger for a product-ready Home composer
- **THEN** Doge SHALL open the dedicated right-side engine/model panel
- **AND** every product engine SHALL expose its current compatible upstream rows in upstream catalog order
- **AND** provider/channel/configuration/add-model controls SHALL NOT be rendered

#### Scenario: User changes one selection dimension

- **WHEN** the user selects another engine
- **THEN** the previously selected product model SHALL remain selected only when compatible with the next engine
- **AND** otherwise Doge SHALL atomically choose that engine's first compatible upstream model
- **WHEN** the user selects another product model
- **THEN** the previously selected engine SHALL remain selected
- **AND** each change SHALL immediately produce one complete managed `ExecutionTarget`

#### Scenario: Selected engine has no compatible model in the entitlement catalog

- **WHEN** the selected engine has no compatible row in the current upstream product catalog
- **THEN** Doge SHALL show that engine as unavailable for product execution
- **AND** it SHALL NOT reuse another engine's model or construct a sendable partial target

#### Scenario: Product model uses a presentation namespace

- **WHEN** a picker/catalog entry uses a namespaced display id while the product authority exposes a raw runtime model id
- **THEN** Doge SHALL persist the catalog identity separately and dispatch the raw runtime model
- **AND** the CLI SHALL NOT fall back to its default model or the global Composer model

#### Scenario: Selected combination fails at runtime

- **WHEN** the selected engine/model protocol route is temporarily unavailable or rejected
- **THEN** Doge SHALL surface a typed recoverable failure for that exact combination and retain the selection
- **AND** Doge SHALL NOT silently switch engine, model, provider, or credential

#### Scenario: Existing Native session selects a different engine

- **WHEN** a product-ready existing Native session selects a different engine
- **THEN** Doge SHALL preserve the immutable Native binding and use the existing new-session/Provider Continuation contract
- **AND** it SHALL NOT mutate the original Native session runtime identity in place
