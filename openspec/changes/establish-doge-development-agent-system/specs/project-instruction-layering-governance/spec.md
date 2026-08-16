## MODIFIED Requirements

### Requirement: Project Instruction Stack MUST Have Explicit Layer Ownership

The repository SHALL define an explicit ownership model for project instructions so that each documentation layer has a single, stable responsibility boundary.

#### Scenario: Instruction layer boundaries are documented

- **WHEN** a collaborator reads the project entry guidance
- **THEN** the repository SHALL describe the distinct roles of project entry, implementation rules, behavior specs, project-neutral agent roles/workflows, host adapter config, and runtime artifacts
- **AND** the guidance SHALL identify which layer is the source of truth for each rule category
- **AND** `.agents/agents/**` SHALL own project-neutral role contracts while `.agents/skills/**` SHALL own reusable project workflows
- **AND** `.codex/**` and `.claude/**` SHALL remain host-specific registration and glue

#### Scenario: Rules are updated in the correct layer

- **WHEN** a collaborator needs to update a frontend/backend implementation rule, behavior requirement, project-neutral agent role, reusable agent workflow, or host-specific hook behavior
- **THEN** the repository SHALL direct that update to the implementation-rule layer, behavior-spec layer, `.agents/agents/**`, `.agents/skills/**`, or host-adapter layer respectively
- **AND** the project entry document SHALL NOT require duplicating the same rule正文 across multiple layers

### Requirement: AGENTS Entry MUST Stay Minimal And Pointer-Oriented

The project entry document SHALL remain a minimal operational entrypoint instead of duplicating implementation manuals, agent role contracts, or workspace snapshots.

#### Scenario: Session-start guidance uses minimal required context

- **WHEN** a new AI or human collaborator starts work in the repository
- **THEN** the project entry document SHALL provide a minimal reading path that starts from itself and then points to the relevant `.trellis/spec/**`, `openspec/**`, or `.agents/agents/README.md` documents by concern
- **AND** it SHALL NOT instruct default full-tree reading of unrelated rule directories or all agent files as the primary path

#### Scenario: Implementation and agent detail remains outside AGENTS

- **WHEN** detailed frontend/backend/cross-layer constraints or agent role contracts are needed
- **THEN** the project entry document SHALL point to `.trellis/spec/**` or `.agents/agents/**` instead of reproducing the detailed rules inline
- **AND** updates to those implementation rules or agent contracts SHALL be made in their owning layer first
