## ADDED Requirements

### Requirement: Atomic Model Selection MUST Link Reasoning Effort To Target Model Capability

When the Atomic target picker (Shared Session or create-session) writes a complete `ExecutionTarget` for a model selection or provider-channel switch, the system MUST resolve `reasoning.effort` from the **target** engine and model capability, not from a cross-engine stale effort and not from an unrelated global `activeEngine` selection.

For Codex models that declare catalog/custom reasoning metadata, the system MUST seed a supported default when inheritance does not apply. For Claude and Grok, the system MUST keep their fixed allowlists and MAY leave effort `null` to mean engine Default when inheritance does not apply.

#### Scenario: Grok to Codex catalog model seeds model default

- **WHEN** the user changes Shared Atomic target from Grok to Codex model `gpt-5.6-sol` (or equivalent catalog entry whose `defaultReasoningEffort` is `low`)
- **THEN** the written `selectedNextTarget.reasoning.effort` MUST be `low`
- **AND** MUST NOT retain the previous Grok effort
- **AND** MUST NOT leave effort as `null` solely because the previous engine was Grok

#### Scenario: same-profile Codex model switch keeps compatible effort

- **WHEN** Shared Atomic target is already Codex on profile P with effort `high`
- **AND** the user selects another Codex model on the same profile that still supports `high`
- **THEN** the written effort MUST remain `high`

#### Scenario: same-profile Codex model switch drops unsupported effort

- **WHEN** Shared Atomic target effort is `ultra`
- **AND** the user selects a Codex model whose supported efforts do not include `ultra`
- **THEN** the written effort MUST fall back to that model’s default (or first supported effort)
- **AND** MUST NOT keep `ultra`

#### Scenario: unknown runtime Codex model stays capability-neutral

- **WHEN** the selected Codex model has no catalog/custom reasoning metadata
- **THEN** the system MUST NOT invent supported options
- **AND** effort MAY be `null`

### Requirement: Shared Atomic Reasoning Options MUST Follow Selected Next Target

While Shared Session or create-session Atomic mode is active, the composer ReasoningSelect options MUST be derived from `selectedNextTarget` / Atomic `executionTarget` engine and model capability. The options MUST NOT be taken solely from the global composer `activeEngine` fixed allowlist when that engine differs from the Atomic target engine.

#### Scenario: Codex target shows catalog options after leaving Grok

- **WHEN** Shared `selectedNextTarget.engine` is `codex` and the selected model is `gpt-5.6-sol`
- **AND** the global app-shell `activeEngine` is still `grok` or another non-codex engine
- **THEN** ReasoningSelect options MUST include the Codex model’s supported efforts (including `xhigh` / `max` / `ultra` when declared by catalog)
- **AND** MUST NOT be limited to Grok’s fixed `low` / `medium` / `high` allowlist alone

#### Scenario: Claude or Grok target keeps fixed allowlist

- **WHEN** Shared `selectedNextTarget.engine` is `claude` or `grok`
- **THEN** ReasoningSelect options MUST use that engine’s fixed allowlist
- **AND** the Default (`null`) option MAY remain available for those engines

### Requirement: Shared Codex Effort MUST Reconcile Null Or Unsupported Values

When Shared Session holds a Codex `selectedNextTarget` with a known catalog/custom model, the system MUST reconcile `reasoning.effort` that is `null` or outside the model’s supported set to the model default (or first supported effort). Reconciliation MUST apply to composer display and MUST apply again at Shared send boundary so UI and dispatch payload cannot diverge. Unknown runtime models without metadata remain capability-neutral and MUST NOT invent efforts.

#### Scenario: hydrated null effort seeds catalog default before send

- **WHEN** Shared history hydrates Codex `gpt-5.6-sol` with `reasoning` absent or `effort: null`
- **THEN** composer display MUST show the model default (`low`) rather than a sticky empty Default state
- **AND** the Shared send payload effort MUST also be `low` after reconciliation

#### Scenario: unsupported effort is clamped on model capability

- **WHEN** Shared Codex target effort is `ultra` but the selected model does not support `ultra`
- **THEN** display and send MUST use that model’s default or first supported effort
- **AND** MUST NOT dispatch `ultra`

### Requirement: Shared Session Initialization MUST NOT Borrow Native Composer Reasoning State

Creating or activating a Shared Session MUST derive reasoning options and effort from the Shared `selectedNextTarget` (or the create-session Atomic target), not from the global Native composer `activeEngine` / `selectedEffort` / model reasoning catalog. After a user has used Native Codex, initializing Shared Grok MUST show only Grok’s fixed allowlist and Default; it MUST NOT show Codex-only tiers such as `xhigh` / `max` / `ultra`, and MUST NOT preselect a leftover Native Codex effort.

#### Scenario: Native Codex then Shared Grok init

- **WHEN** the global Native composer last used Codex with a non-null effort and full model reasoning options
- **AND** the user creates a Shared Session with initial engine Grok and a local default model
- **THEN** the composer ReasoningSelect options MUST be limited to Grok’s fixed `low` / `medium` / `high` (plus Default)
- **AND** MUST NOT include `xhigh` / `max` / `ultra`
- **AND** the selected effort MUST NOT inherit the previous Native Codex effort solely because `activeEngine` is still Codex

#### Scenario: Shared without hydrated target fail-closed for reasoning UI

- **WHEN** the active conversation is Shared but `selectedNextTarget` is not yet available
- **THEN** the composer MUST NOT fall back to Native/global reasoning options or effort
- **AND** MAY show an empty option set and null effort until the Shared target hydrates
