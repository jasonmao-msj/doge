## ADDED Requirements

### Requirement: New doge state MUST use doge-owned storage identities

New application state MUST be written under `~/.doge`, the doge bundle app-data directory, and doge-prefixed client-store/localStorage/protocol namespaces. After migration, normal doge writes MUST NOT target `.ccgui`, `.mossx`, `.codemoss` or an upstream bundle app-data directory.

#### Scenario: Fresh doge profile starts

- **WHEN** no doge or legacy state exists
- **THEN** the application MUST resolve `~/.doge` as the app-home root
- **AND** persisted client state MUST use doge-owned keys and app-data paths
- **AND** no legacy root MUST be created as a side effect

#### Scenario: A feature persists new state

- **WHEN** a doge feature writes configuration, project memory, canvas, logs, provider homes or client-store data
- **THEN** the destination MUST resolve beneath a doge-owned root or key namespace

### Requirement: Legacy filesystem state MUST copy forward safely

When doge state is absent, the application MUST inspect supported legacy roots and bundle app-data candidates in a deterministic priority order and copy one valid source forward. Migration MUST preserve the source, MUST NOT overwrite existing doge data and MUST be idempotent.

#### Scenario: ccgui state exists and doge state is absent

- **WHEN** `~/.ccgui` contains valid state and `~/.doge` does not contain existing doge data
- **THEN** doge MUST copy the supported state into `~/.doge`
- **AND** the `~/.ccgui` source MUST remain unchanged
- **AND** a migration sentinel MUST identify the source category and migration schema version

#### Scenario: Multiple legacy roots exist

- **WHEN** supported `.ccgui`, `.mossx` or `.codemoss` roots coexist and doge state is absent
- **THEN** the implementation MUST choose exactly one source using the documented priority
- **AND** `.ccgui` MUST take precedence over older legacy roots

#### Scenario: doge data already exists

- **WHEN** the doge destination already contains valid settings, workspaces, models or feature data
- **THEN** legacy migration MUST NOT overwrite or merge that data
- **AND** a later launch MUST continue using the doge destination

#### Scenario: Migration runs repeatedly

- **WHEN** doge starts again after a completed copy-forward
- **THEN** it MUST NOT recopy legacy files over doge changes
- **AND** it MUST NOT delete any doge or legacy data

### Requirement: Legacy client keys MUST migrate by destination-wins copy

For each supported localStorage/client-store key, doge MUST read the doge key first and MAY copy a legacy value only when the doge key is absent. Migration MUST NOT delete the legacy key during this change.

#### Scenario: Only a legacy key exists

- **WHEN** a supported `ccgui.*` or `mossx.*` key exists and its doge equivalent is absent
- **THEN** doge MUST persist the equivalent value under the doge key
- **AND** subsequent reads MUST use the doge key

#### Scenario: Both keys exist

- **WHEN** both doge and legacy variants exist
- **THEN** the doge value MUST win
- **AND** migration MUST NOT overwrite it with the legacy value

### Requirement: Serialized compatibility MUST be dual-read and doge-write

Persisted internal markers, MIME/media types, context package tags and daemon discovery names that can exist in old histories or artifacts MUST remain readable through an explicit compatibility layer. Newly generated records MUST use doge identifiers.

#### Scenario: Old serialized artifact is opened

- **WHEN** doge reads a supported record containing a legacy `mossx` or `ccgui` protocol marker
- **THEN** it MUST interpret the record using the existing semantics
- **AND** the marker MUST NOT become visible as product branding in normal UI

#### Scenario: New serialized artifact is created

- **WHEN** doge writes the corresponding marker, MIME/media type or internal package
- **THEN** it MUST use the doge namespace
- **AND** it MUST remain readable after application restart

### Requirement: Migration diagnostics MUST not expose secrets

Migration evidence MUST be bounded to source category, schema version, timestamp and result. It MUST NOT record API keys, provider tokens, file payloads, full serialized histories or sensitive query data.

#### Scenario: Migration succeeds or fails

- **WHEN** doge records a migration sentinel, log entry or error
- **THEN** diagnostics MUST be sufficient to identify the migration stage and source category
- **AND** secrets and user content MUST be absent
