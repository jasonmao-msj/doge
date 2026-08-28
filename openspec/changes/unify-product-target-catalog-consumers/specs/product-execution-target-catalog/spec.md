## ADDED Requirements

### Requirement: Product Consumers MUST Share One Canonical Execution Target Catalog

Doge MUST project upstream Product engines and models into one canonical catalog of executable target rows. The
projection MUST preserve engine identity, managed Provider identity, model catalog identity, CLI runtime model,
display metadata, and exact API protocol compatibility. Composer, Kanban, target repair, and execution preparation
MUST consume this projection rather than independently filtering or reconstructing Product model rows.

#### Scenario: Product catalog reaches every selector consistently

- **GIVEN** Product entitlement is ready with Codex, Claude, and Kimi engines
- **WHEN** the user opens Composer or Kanban engine/model selection
- **THEN** both surfaces MUST derive engines and models from the same canonical Product target catalog
- **AND** local-only Grok/OpenCode rows MUST NOT appear
- **AND** model ids, runtime values, order, and labels MUST remain identical for the same engine

#### Scenario: Exact endpoint compatibility is projected once

- **WHEN** an upstream model supports one or more canonical API protocols
- **THEN** the catalog owner MUST project that row only to engines supporting those exact protocols
- **AND** consumers MUST NOT repeat protocol or model-name heuristics
- **AND** unknown or incompatible rows MUST fail closed

#### Scenario: Installation state is not entitlement state

- **GIVEN** an entitled Product engine is not currently installed
- **WHEN** a selector renders the canonical Product target catalog
- **THEN** the engine MUST remain selectable when it has a compatible target row
- **AND** the system MUST NOT falsify `EngineStatus.installed`
- **AND** installation MUST remain owned by the later execution preparation boundary

#### Scenario: Catalog id differs from runtime model

- **WHEN** a Product model row has `id != model` or requires normalized runtime identity
- **THEN** the target row MUST preserve both `modelCatalogEntryId` and runtime `model`
- **AND** selector labels MAY use catalog metadata
- **AND** actual execution MUST send the runtime `model`

### Requirement: Kanban Tasks MUST Persist And Execute The Selected Exact Target

New or edited Kanban tasks MUST persist a complete `ExecutionTarget` alongside backward-compatible flat fields.
Every launch path MUST resolve and validate that target before creating a TaskRun, session, binding, or turn. Managed
targets MUST prepare the exact engine before session side effects, and MUST preserve the managed Provider identity.

#### Scenario: New Product task freezes a managed target

- **WHEN** a Product user selects an engine/model and creates or edits a Kanban task
- **THEN** the task MUST persist engine, managed `providerProfileId`, `modelCatalogEntryId`, runtime `model`, and
  readable Provider facts
- **AND** `engineType/modelId` MUST remain a compatible mirror for older clients

#### Scenario: Scheduled execution uses the persisted runtime identity

- **GIVEN** a Kanban task stores a Product target whose catalog id differs from runtime model
- **WHEN** autoStart, drag, scheduled, chained, retry, or fork launches the task
- **THEN** TaskRun and first send MUST use the target runtime model
- **AND** session creation MUST use the target engine and managed Provider profile
- **AND** the current global active engine MUST NOT rewrite the task target

#### Scenario: Legacy task is repaired without silent provider drift

- **GIVEN** an old task stores only `engineType + modelId`
- **WHEN** Product entitlement is ready
- **THEN** execution MUST resolve those fields against the current canonical Product catalog
- **AND** a compatible match MUST become a managed target
- **AND** no match MUST fail closed rather than run against a local/default Provider

#### Scenario: Local legacy task remains compatible

- **GIVEN** Product entitlement is not active and a legacy task stores only flat fields
- **WHEN** the task is opened or launched
- **THEN** Local Mode MUST preserve existing local engine/model behavior
- **AND** Product-only provider facts MUST NOT be invented

