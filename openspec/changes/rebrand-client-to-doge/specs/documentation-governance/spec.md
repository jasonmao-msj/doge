## ADDED Requirements

### Requirement: Current product documentation MUST use doge identity and preserve provenance boundaries

Current README, documentation hubs, development guides and living OpenSpec context MUST describe doge as the current product and MUST use current doge repository, download, issue, package, bundle and storage facts. Original legal notices and immutable historical evidence MUST retain their truthful provenance instead of being mechanically rebranded.

#### Scenario: Reader opens current product documentation

- **WHEN** a reader opens README, current documentation hub or maintained development guide
- **THEN** the current product name, repository commands, release links and storage examples MUST use doge
- **AND** upstream product/download/issue links MUST NOT be presented as current doge actions

#### Scenario: Reader opens legal or immutable historical content

- **WHEN** a reader opens `LICENSE`, an archived OpenSpec change, dated evidence or preserved changelog
- **THEN** original copyright and capture-time product names MUST remain truthful
- **AND** current indexes MUST distinguish that content from doge current-product documentation

#### Scenario: Current documentation states product capability

- **WHEN** current doge documentation describes the AI Shiba life-and-work assistant vision
- **THEN** it MUST separately identify the currently shipped developer-workflow capabilities
- **AND** it MUST NOT describe unimplemented life integrations as available

### Requirement: Developer upstream documentation MUST not become a product surface

If the repository documents upstream synchronization, that documentation MUST be classified as developer workflow and MUST NOT be linked from user-facing About, download, feedback or update surfaces.

#### Scenario: Developer follows upstream sync guidance

- **WHEN** a contributor reads the developer-only sync guidance
- **THEN** it MAY identify the upstream repository and semantic merge process
- **AND** no runtime or user-facing product action MUST depend on that guidance
