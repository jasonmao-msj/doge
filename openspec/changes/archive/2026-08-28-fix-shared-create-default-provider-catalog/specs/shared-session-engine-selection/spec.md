## MODIFIED Requirements

### Requirement: Shared Session Creation MUST Explicitly Select A Ready CLI

The Sidebar `Shared CLI` creation action MUST expose a second-level selector containing every Shared-supported CLI. Selecting a ready CLI MUST create the Shared Session with that CLI as the initial target engine. The system MUST NOT infer the initial engine or Model from the currently active Composer.

After the CLI is chosen, the system MUST resolve the **first Provider profile** in that CLI’s ordered provider catalog (same order as the Atomic target picker: local/default sentinel first when present, then managed profiles) and MUST load that Provider’s **authoritative** model catalog before persisting `initialTarget`. The system MUST NOT seed create-time models from a bare engine-wide model list or a non-force-refreshed engine status cache.

#### Scenario: create Shared Session with a different active engine

- **WHEN** the active Composer targets Claude and the user selects Grok from the `Shared CLI` submenu
- **THEN** the new Shared Session MUST use Grok as its initial target engine
- **AND** it MUST NOT copy the Claude Composer Provider, Model, or Reasoning selection

#### Scenario: unavailable CLI remains diagnosable

- **WHEN** a Shared-supported CLI is not ready in the selected workspace
- **THEN** its submenu item MUST be disabled with the current availability reason
- **AND** the system MUST NOT create a partial Shared Session

#### Scenario: selected CLI defaults to first provider with authoritative catalog

- **WHEN** the user selects a ready CLI from the Shared creation submenu
- **THEN** the system MUST resolve that CLI’s ordered Provider list and select the first profile
- **AND** MUST load models with provider-profile scope (local/default MUST use force-refresh so disk/settings are re-read; managed MUST use provider-scoped config/env)
- **AND** MUST pick the catalog default model when present, otherwise the first catalog row
- **AND** MUST persist a complete initial `ExecutionTarget` (engine, provider semantics, catalog entry id, runtime model, readable provider snapshot) before opening the session
- **AND** MUST NOT label the target as local/default unless the first profile is the local/default sentinel

#### Scenario: Claude create syncs model mapping for the default provider

- **WHEN** the user creates a Shared Session with Claude and a resolved first Provider profile
- **THEN** the system MUST sync Claude ANTHROPIC model mapping for that profile before or as the session becomes visible
- **AND** mapping sync failure MUST NOT by itself abort session creation when the ExecutionTarget is already complete

#### Scenario: empty catalog fails closed

- **WHEN** the first Provider profile for the selected CLI has no usable model row after authoritative load
- **THEN** Shared Session creation MUST fail with an actionable error
- **AND** MUST NOT create a Shared Session directory, metadata row, Binding, or Turn fact

#### Scenario: selected CLI resolves a complete local target

- **WHEN** the user selects a ready CLI from the Shared creation submenu
- **THEN** the system MUST resolve that CLI's canonical local Provider and runtime-authoritative default Model
- **AND** it MUST persist a complete initial `ExecutionTarget` before opening the session

## ADDED Requirements

### Requirement: Opening An Existing Shared Session MUST Restore Last Selected Target

When the user opens or re-activates an existing Shared Session, the Composer next-target picker MUST restore the durable last `selectedTarget` / in-memory `selectedNextTarget` for that session. Create-time default Provider resolution MUST NOT run on open and MUST NOT overwrite a previously persisted complete target.

#### Scenario: reopen restores last provider and model

- **WHEN** a Shared Session was last used with a non-default Provider or Model
- **AND** the user later re-opens that session
- **THEN** the Atomic picker closed state and `selectedNextTarget` MUST show that last Provider and Model
- **AND** MUST NOT reset to the create-time first-provider default

#### Scenario: incomplete legacy target stays fail-closed on open

- **WHEN** a legacy Shared Session hydrates without a complete next target
- **THEN** the picker MUST remain unselected / incomplete rather than inventing a create-time default silently for send
- **AND** V2 send MUST continue to reject incomplete targets
