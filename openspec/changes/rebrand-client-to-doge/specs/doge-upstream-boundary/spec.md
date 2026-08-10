## ADDED Requirements

### Requirement: Upstream knowledge MUST be developer-only

The developer Git topology MAY retain a read-only `upstream` fetch remote for `zhukunpenglinyutong/desktop-cc-gui`. The upstream remote or repository identity MUST NOT be consumed by doge runtime, user settings, update logic, About, feedback or download actions.

#### Scenario: Developer synchronizes upstream

- **WHEN** a developer fetches `upstream/main`
- **THEN** the fetch MUST be possible without changing doge runtime configuration
- **AND** upstream push SHOULD remain disabled in the local clone

#### Scenario: Application is built

- **WHEN** doge is compiled or packaged
- **THEN** local Git remote configuration MUST NOT be bundled as an application setting
- **AND** the running application MUST NOT need access to the upstream repository

### Requirement: doge shipping runtime MUST not consume upstream-owned services

Shipping code and configuration MUST NOT call an upstream updater, analytics property, issue/download endpoint, web-assets release path or managed provider endpoint. Generic user-configured provider URLs MAY remain supported when they are not doge defaults.

#### Scenario: Normal production application starts

- **WHEN** the main production renderer and backend initialize
- **THEN** no request MUST be initiated to upstream-owned analytics or product infrastructure
- **AND** no upstream-specific provider endpoint MUST be selected by default

#### Scenario: User configures a custom provider

- **WHEN** the user explicitly supplies a third-party compatible base URL
- **THEN** doge MAY use that URL under the existing provider contract
- **AND** the URL MUST NOT be represented as a doge-owned managed service unless doge controls it

### Requirement: Legal, historical and compatibility truth MUST remain traceable

The original MIT copyright/license, immutable commit/archive history and required legacy compatibility tokens MUST be preserved. Their presence MUST NOT authorize showing the upstream as the current doge product owner.

#### Scenario: Source distribution includes license

- **WHEN** doge source or a substantial source distribution is provided
- **THEN** the original MIT copyright and permission notice MUST remain intact
- **AND** doge MAY add its own copyright without replacing prior notices

#### Scenario: Historical document is read

- **WHEN** a reader opens immutable archived evidence that names a legacy product
- **THEN** the historical wording MAY remain
- **AND** current indexes MUST not present it as doge's current product identity

### Requirement: Brand and service gates MUST use narrow reasoned allowlists

Automated checks MUST scan shipping source/config/docs for legacy brand names and upstream-owned endpoints. Each allowed occurrence MUST be path/line-pattern scoped and classified as legal, historical, migration, protocol compatibility, developer sync or external schema compatibility.

#### Scenario: Upstream merge introduces a legacy endpoint

- **WHEN** a merge adds an upstream URL or legacy brand token to a non-allowlisted shipping surface
- **THEN** the brand/service gate MUST fail with the file and line
- **AND** the change MUST not pass `doctor:strict` or release CI

#### Scenario: Compatibility reader retains a legacy token

- **WHEN** a migration or protocol reader contains an approved legacy token
- **THEN** the gate MAY pass only through a narrow reasoned allowlist entry
- **AND** new writes or visible copy in the same area MUST still use doge

### Requirement: Upstream merges MUST preserve doge high-risk identities semantically

Updater, signing, bundle identifier, app-home, release workflow, analytics removal and canonical brand files MUST be treated as high-risk merge surfaces. They MUST NOT be resolved through whole-file `ours` or `theirs` replacement without a capability comparison and post-merge validation.

#### Scenario: Upstream changes a high-risk file

- **WHEN** an upstream merge conflicts in a doge identity or distribution file
- **THEN** the developer MUST compare upstream capability changes with doge invariants
- **AND** the resolved result MUST pass brand/service, migration and updater focused tests
