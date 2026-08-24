# account-product-subscription-center Specification

## ADDED Requirements

### Requirement: Account Center SHALL Present One Product Subscription

Account Center MUST present the active Doge subscription as one product card rather than engine-scoped subscription cards.

#### Scenario: Product subscription is active

- **WHEN** the user opens the Subscription tab
- **THEN** the card SHALL show the upstream plan name, active state, `YYYY-MM-DD` expiry and available model count
- **AND** model details SHALL remain visible without a collapse control
- **AND** model details SHALL group the upstream catalog by presentation vendor and show the corresponding model brand icon
- **AND** monochrome provider/model icons SHALL remain legible across light, dark, dim and system themes through one shared icon theme strategy
- **AND** vendor grouping SHALL retain upstream order within each vendor without changing entitlement
- **AND** engine, API key, credential and catalog refresh timestamp SHALL NOT appear as commercial facts

### Requirement: Account Center SHALL Render Product Details As One Progressive Page

Account Center MUST render profile, subscription, usage and billing in one scrollable information hierarchy. Profile and prepared entitlement facts MUST be visible without waiting for analytics or order history.

#### Scenario: Slow product reads are still in flight

- **WHEN** the authenticated account center opens
- **THEN** the profile and product status SHALL render immediately from existing authoritative snapshots
- **AND** usage and billing SHALL each render a layout-stable skeleton owned by that section
- **AND** completion or failure of one section SHALL NOT clear or block the other section

#### Scenario: A section is refreshed

- **WHEN** usage or billing already has last-known-good data and a refresh starts
- **THEN** Doge SHALL retain the existing rows with a refreshing affordance
- **AND** a stale response from an older period/generation SHALL NOT overwrite the current selection

### Requirement: Product Usage SHALL Use Selected Authority Ranges

Product usage MUST be scoped to the active Composite subscription/group and a validated date range selected by the user.

#### Scenario: User selects a preset or custom range

- **WHEN** the user selects a preset or valid custom start/end date and `day | hour` granularity
- **THEN** Doge SHALL query that exact inclusive date range through `/usage/stats` and `/usage/dashboard/snapshot-v2`
- **AND** granularity SHALL be passed to the snapshot authority without client-side invention
- **AND** total requests, token breakdown, standard/actual cost, average duration and model rows SHALL come only from those responses
- **AND** malformed, future, reversed or unbounded ranges SHALL fail closed before network reads
- **AND** the date-range overlay SHALL be opaque and keep presets, date fields and apply action visually distinct from usage rows beneath it

#### Scenario: Engine attribution is not authoritative

- **WHEN** token2api does not return a Doge runtime-engine aggregation dimension
- **THEN** Doge SHALL NOT render an engine usage block or placeholder counts
- **AND** it SHALL NOT infer engine counts from model ids, model families or User-Agent strings

#### Scenario: Model usage facts are available

- **WHEN** token2api returns per-model usage for the selected range
- **THEN** Doge SHALL render one semantic table containing model, request count, total tokens, actual cost and standard cost
- **AND** it SHALL NOT duplicate the same models as a request-only ranking chart

#### Scenario: Token trend facts are available

- **WHEN** the selected-range snapshot returns trend buckets
- **THEN** Doge SHALL show Input, Output, Cache Creation, Cache Read and derived Cache Hit Rate series
- **AND** Cache Hit Rate SHALL use `cacheRead / (input + cacheRead + cacheCreation) * 100` on a right-side 0–100% axis
- **AND** each legend item SHALL toggle its series without changing the selected range or refetching authority data
- **AND** hovering a date bucket SHALL show Input, Output, Cache Creation, Cache Read, Actual and Standard facts for that bucket
- **AND** model rows SHALL use a bounded scroll region with a sticky header so model and trend panels remain visually balanced
- **AND** every Token count SHALL use locale-independent uppercase `K/M/B` units

### Requirement: Billing Rows SHALL Remain Truthful To Upstream Capability

Billing history MUST use the authenticated user's subscription orders and MUST NOT imply an invoice artifact exists when the upstream exposes no invoice download contract.

#### Scenario: Subscription orders are available

- **WHEN** `/payment/orders/my` returns safe subscription order facts
- **THEN** Account Center SHALL show date, plan label, paid amount/currency and normalized status
- **AND** no download action SHALL be enabled without an authoritative invoice URL or artifact id

#### Scenario: Billing history fails while usage succeeds

- **WHEN** the billing request fails independently
- **THEN** usage SHALL remain visible
- **AND** the billing section SHALL show a localized retryable state without raw server diagnostics

### Requirement: Existing Account Lifecycle Controls SHALL Be Preserved

The unified subscription redesign MUST retain capability-driven profile, password, security, identity binding, current-device logout and all-device logout behavior.

#### Scenario: User manages account security

- **WHEN** the corresponding server capability is enabled
- **THEN** Account Center SHALL continue to offer the existing mature interaction instead of replacing it with prototype-only content

### Requirement: Usage SHALL Be Product And Model Scoped

Usage summary and detail MUST use the product subscription/group as the billing scope and MUST treat model as the drill-down dimension.

#### Scenario: Sidebar usage preview is opened

- **WHEN** the user clicks the account shortcut
- **THEN** the preview SHALL lazy-load upstream usage windows and display integer percentages only
- **AND** clicking identity SHALL open the account detail at its profile section while clicking usage SHALL open/focus the usage section

#### Scenario: Usage detail is opened

- **WHEN** the user opens or focuses the usage section
- **THEN** Doge SHALL show the product-scoped usage facts available from the product entitlement authority
- **AND** daily trend, heatmap and per-model details SHALL appear only when product-scoped authority facts are available
- **AND** engine SHALL NOT be used as a billing or subscription grouping dimension
- **AND** legacy engine-scoped subscription cards and analytics SHALL NOT be rendered as a fallback while product entitlement is ready
