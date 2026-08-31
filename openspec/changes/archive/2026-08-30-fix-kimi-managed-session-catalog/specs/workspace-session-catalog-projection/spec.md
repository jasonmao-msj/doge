## ADDED Requirements

### Requirement: Workspace Session Projection MUST Discover Managed Kimi Provider Homes

Workspace session catalog projection MUST include Kimi sessions stored under app-local managed provider homes in addition to the configured/default Kimi home when no explicit custom history home is supplied.

#### Scenario: managed Kimi session appears after restart

- **WHEN** a Kimi session exists under `kimi-provider-homes/<providerId>/session_index.jsonl`
- **AND** the application restarts without an in-memory provider home configuration
- **AND** the index entry `workDir` belongs to the requested workspace
- **THEN** the workspace session catalog MUST include that Kimi session
- **AND** the row MUST expose `providerProfileId` when the provider-home id is available

#### Scenario: managed Kimi history remains workspace-scoped

- **WHEN** managed Kimi provider homes contain sessions for multiple workspaces
- **AND** the catalog requests one workspace
- **THEN** only entries whose `workDir` matches that workspace or a child path MUST be returned
- **AND** provider-home membership alone MUST NOT prove workspace ownership

### Requirement: Kimi Catalog Source Completeness MUST Preserve Provider-Home Failures

Kimi catalog source status MUST distinguish a complete empty scan from an incomplete managed provider-home enumeration.

#### Scenario: provider-home enumeration fails

- **WHEN** the managed Kimi provider-home parent exists but cannot be enumerated
- **THEN** the Kimi source MUST be reported as partial or degraded
- **AND** omitted managed-provider sessions MUST NOT be treated as authoritative deletion evidence

### Requirement: Kimi History Operations MUST Use the Discovered Provider Home

Kimi list, load, and delete operations MUST resolve a session through the same provider-home set and MUST operate on the root where the session was discovered.

#### Scenario: discovered managed session can be loaded and deleted

- **WHEN** a managed Kimi session is returned from provider-home discovery
- **THEN** loading it MUST read that provider home's `wire.jsonl`
- **AND** deleting it MUST remove only that session directory and its matching index entry
- **AND** the provider home and unrelated sessions MUST remain intact
