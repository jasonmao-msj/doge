## ADDED Requirements

### Requirement: Development Agent Catalog SHALL Have One Accountable Owner

The repository SHALL define a project-neutral development agent catalog with `doge-project-lead` as the single accountable owner for task routing, integration, validation, and final completion.

#### Scenario: End-to-end task enters the agent system

- **WHEN** a user requests a doge development task that benefits from multiple roles
- **THEN** `doge-project-lead` SHALL select the minimal complete agent chain
- **AND** delegated agents MUST NOT replace the lead's final integration and acceptance responsibility

#### Scenario: New agent is added

- **WHEN** a collaborator creates `.agents/agents/<agent-name>.md`
- **THEN** the file name and frontmatter `name` MUST match
- **AND** the definition MUST declare scope, non-goals, required context, workflow, handoff, validation, and escalation
- **AND** `doge-project-lead` MUST review overlap and least-privilege boundaries before activation

### Requirement: Dispatch SHALL Be Triggered And Bounded

Every agent dispatch MUST use a bounded brief containing goal, ownership, context, non-goals, deliverables, validation, and a shared-workspace collaboration notice.

#### Scenario: Lead dispatches a specialist

- **WHEN** a task matches a catalog trigger
- **THEN** the lead MUST provide the complete dispatch brief
- **AND** the specialist MUST stay within the assigned ownership
- **AND** missing critical context MUST be reported as a visible blocker rather than silently invented

#### Scenario: Specialist trigger does not match

- **WHEN** a task does not touch a specialist's declared risk surface
- **THEN** the lead SHALL mark that gate not applicable or omit it from the chain
- **AND** the system MUST NOT run every specialist by default

### Requirement: Parallel Work SHALL Protect Ownership

The agent system MUST treat disjoint ownership as the unit of safe parallelism.

#### Scenario: Write agents run in parallel

- **WHEN** two or more write-capable agents are dispatched concurrently
- **THEN** their file or module ownership MUST be disjoint
- **AND** shared schema, constants, registries, migrations, and specs MUST have one explicit owner
- **AND** every agent MUST preserve unrelated user and agent changes

#### Scenario: Ownership overlap is discovered

- **WHEN** an agent detects another change in its assigned write surface
- **THEN** it MUST stop conflicting writes and notify `doge-project-lead`
- **AND** the lead MUST resolve the overlap through reallocation or semantic integration
- **AND** destructive whole-file conflict resolution MUST NOT be used

### Requirement: Agent Handoffs SHALL Be Evidence Backed

Lifecycle and domain agents MUST return a role-appropriate handoff artifact containing verifiable evidence and unresolved risk.

#### Scenario: Implementation agent completes work

- **WHEN** an implementation agent reports completion
- **THEN** its handoff MUST list files changed, behavior implemented, validation commands and results, and remaining risks
- **AND** `doge-project-lead` MUST inspect the actual diff before accepting the handoff

#### Scenario: Validation is unavailable or fails

- **WHEN** a required command cannot run or returns a failure
- **THEN** the handoff MUST record the exact failure, impact, and any alternative evidence
- **AND** the task MUST NOT be reported complete while a blocking gate remains unresolved

### Requirement: Risk Specialists SHALL Be Conditional Blocking Gates

The catalog SHALL define explicit triggers for UX, engine integration, performance/reliability, security/privacy, documentation governance, and release specialists.

#### Scenario: Risk trigger is matched

- **WHEN** a change touches a declared specialist risk surface
- **THEN** `doge-project-lead` MUST include that specialist or an equivalent documented gate
- **AND** unresolved high-severity findings MUST block completion

#### Scenario: New CLI engine integration is requested

- **WHEN** a task adds, restores, or changes a CLI engine integration surface
- **THEN** `engine-integration-engineer` MUST follow the repository Engine Onboarding Gate and evidence matrix
- **AND** frontend, backend/runtime, quality, documentation governance, and release ownership MUST be assigned where their surfaces are affected

### Requirement: Development Workforce SHALL Represent Distinct Software Disciplines

The catalog SHALL provide distinct project roles for product/spec, UX/UI, architecture, frontend, backend/runtime, desktop platform, data/storage, engine integration, automated testing, manual QA, general and framework/language review, build-error repair, silent-failure analysis, type-contract analysis, maintainability refactoring, performance/reliability, security/privacy, observability, build/CI, dependency supply-chain, documentation governance, release delivery, and agent-system evaluation.

#### Scenario: Rich specialist roles are cataloged

- **WHEN** a collaborator inspects `.agents/agents/README.md`
- **THEN** each software discipline MUST have a named owner or specialist with a trigger and primary handoff
- **AND** overlapping disciplines MUST document their ownership boundary and escalation path

#### Scenario: Quality work is decomposed

- **WHEN** a change requires both automated and manual validation
- **THEN** `quality-engineer` SHALL own the acceptance matrix and aggregate verdict
- **AND** `test-automation-engineer` SHALL own automated coverage
- **AND** `manual-qa-engineer` SHALL own human, device, and platform evidence

#### Scenario: Platform and data work are decomposed

- **WHEN** a backend change touches desktop OS integration or persisted data contracts
- **THEN** `desktop-platform-engineer` or `data-storage-engineer` MUST own those specialist surfaces
- **AND** `backend-runtime-engineer` MUST NOT silently absorb their high-risk gates without an explicit combined assignment

#### Scenario: Framework and failure review is decomposed

- **WHEN** a change touches React/TypeScript, Rust/Tauri, shared types, or error/fallback paths
- **THEN** the lead SHALL dispatch the matching framework or failure specialist when risk warrants it
- **AND** each specialist MUST stay within its declared lane
- **AND** findings MUST pass an exact-location, concrete-failure, surrounding-context, and defensible-severity confidence gate

#### Scenario: Agent system learns from complex delegation

- **WHEN** a non-trivial multi-agent task or agent catalog change completes
- **THEN** `agent-system-evaluator` MAY score handoff and dispatch quality without re-performing the original task
- **AND** recommended improvements MUST point to specific role or brief contracts

### Requirement: Development Lifecycle SHALL Close Through Independent Verification

Code-changing tasks SHALL include implementation validation and independent review before `doge-project-lead` declares completion.

#### Scenario: Standard behavior feature completes

- **WHEN** implementation agents finish a behavior-changing feature
- **THEN** `quality-engineer` MUST validate the acceptance matrix
- **AND** `change-reviewer` MUST review correctness, missing update sites, test coverage, and spec drift
- **AND** `documentation-governance-owner` MUST close applicable OpenSpec and Trellis artifacts
- **AND** the lead MUST produce a final closure report

#### Scenario: Small direct edit completes

- **WHEN** the lead determines a task is a small low-risk direct edit
- **THEN** non-applicable lifecycle agents MAY be skipped
- **AND** PlanFirst, focused ownership, proportional validation, shared-workspace protection, and lead acceptance MUST still apply

### Requirement: Project Roles SHALL Map To Host Execution Without Duplication

Project-neutral agent definitions MUST remain the role source of truth while host-specific configurations provide only execution registration and adapter glue.

#### Scenario: Lead invokes a project role through Codex

- **WHEN** a project role is executed using `plan`, `research`, `implement`, `check`, `debug`, `explorer`, or `worker`
- **THEN** the dispatch brief MUST identify the project role contract being applied
- **AND** the host execution role MUST NOT become a divergent copy of project governance

#### Scenario: Native registration is added later

- **WHEN** a project role receives a host-native registration
- **THEN** the adapter MUST remain minimal and reference the project-neutral responsibilities
- **AND** changes to the role contract MUST be made in `.agents/agents/**` first
