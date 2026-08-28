## MODIFIED Requirements

### Requirement: Managed account defaults SHALL load their own provider-scoped catalog

When an authenticated account preparation selects `doge-token-matrix` as the default provider for an eligible engine, the UI MUST request and use that provider's model catalog before it derives a new-session model selection. A local/disk catalog entry MUST NOT be reused under the managed profile identity.

#### Scenario: active engine changes after account preparation

- **WHEN** the App Shell activates an eligible managed Codex or Claude engine after successful account preparation
- **THEN** the provider-scoped catalog request MUST use `doge-token-matrix`
- **AND** any stale local/disk model selection outside that catalog MUST be repaired or omitted according to the existing model-catalog contract
