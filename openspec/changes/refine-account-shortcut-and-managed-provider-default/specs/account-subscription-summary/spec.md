## ADDED Requirements

### Requirement: Account subscription summary SHALL provide lightweight authority facts

When an authenticated account requests `subscription.read`, Doge MUST fetch only the existing subscription-summary authority data and the existing desktop engine catalog needed for reliable engine attribution. The operation MUST NOT fetch the usage dashboard, daily trend, or per-model analytics.

#### Scenario: active subscribed engine summary

- **WHEN** an authenticated account has an active supported Codex or Claude entitlement
- **THEN** the canonical projection MUST include a stable subscription identity, plan/group label, status, available usage windows and expiry timestamp
- **AND** it MUST include the matching `engineId` only when attribution is supported by the desktop catalog
- **AND** it MUST preserve multiple subscription identities as distinct entries

#### Scenario: unrecognized future subscription

- **WHEN** authority returns a valid subscription that Doge cannot reliably map to a supported engine
- **THEN** Doge MUST retain its subscription/plan facts with no engine identity
- **AND** it MUST NOT label it Codex or Claude by heuristic

#### Scenario: summary unavailable

- **WHEN** the authority, vault, session, capability or response shape is unavailable
- **THEN** the operation MUST return the existing typed unavailable/error contract
- **AND** it MUST NOT fabricate quota, expiry or engine values

### Requirement: Account subscription UI SHALL disclose each subscription progressively

The authenticated Account Center subscription surface MUST render one responsive card per subscription summary entry. A card MUST show plan identity and, when authority provides them, the current daily usage/limit and expiry. It MUST NOT use a full dashboard read to obtain those compact facts.

#### Scenario: account owns multiple subscriptions

- **WHEN** an account owns more than one active subscription, including multiple subscriptions for the same engine
- **THEN** each subscription MUST remain independently visible in the responsive card layout
- **AND** card labels MUST use the authority plan/group fact rather than an engine-only "subscribed" label
