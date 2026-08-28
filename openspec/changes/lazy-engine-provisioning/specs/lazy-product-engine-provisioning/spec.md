# lazy-product-engine-provisioning Specification

## ADDED Requirements

### Requirement: Authenticated Product Shell SHALL Not Wait For CLI Engines

After authentication and active subscription catalog authority are established, Doge MUST mount Home/AppShell without
inspecting、installing、selecting、verifying or activating Codex、Claude Code or Kimi CLI. CLI availability MUST NOT be
part of the Product router gate.

#### Scenario: No managed CLI is available after login

- **GIVEN** the account is authenticated and its Product subscription is active
- **AND** Codex、Claude Code and Kimi CLI are absent or unavailable
- **WHEN** Product catalog bootstrap completes
- **THEN** Doge SHALL enter Home
- **AND** SHALL NOT render an engine-specific full-screen preparing or failure surface
- **AND** Sidebar、Settings、Account and already-readable conversations SHALL remain usable

#### Scenario: Background model bootstrap fails

- **WHEN** Product key/model bootstrap fails after Home has mounted
- **THEN** Doge SHALL preserve AppShell and publish a retryable stale/unavailable model-catalog state
- **AND** SHALL NOT return to a blocking Account gate

### Requirement: Managed Product Engines SHALL Provision Only At Send Time

Doge MUST prepare only the frozen managed engine selected by the current send. Product credential/configuration、toolchain
resolution/installation and required activation MUST finish before any Session、Shared Binding or Turn side effect.

#### Scenario: First send selects one engine

- **GIVEN** the selected target uses `doge-token-matrix`
- **AND** its engine is not ready
- **WHEN** the user sends a message
- **THEN** Doge SHALL prepare only that engine
- **AND** SHALL NOT inspect or install either unselected Product engine
- **AND** after success SHALL automatically continue the exact original message with the frozen engine/provider/model/reasoning target

#### Scenario: Same engine receives concurrent sends

- **WHEN** two sends request the same unprepared managed engine before provisioning settles
- **THEN** they SHALL share one idempotent provisioning owner
- **AND** Doge SHALL NOT duplicate installer、credential、configuration or activation mutations

#### Scenario: Kimi is selected

- **WHEN** Kimi provisioning succeeds
- **THEN** the turn SHALL route through the explicit Kimi engine/provider target
- **AND** Doge SHALL NOT require a global active-engine read-back or report a global switch failure

#### Scenario: Provisioning fails before side effect

- **WHEN** access、toolchain、installer、verification or activation fails
- **THEN** Doge SHALL create no partial Session、Binding or Turn
- **AND** SHALL restore or retain the submitted draft and attachments
- **AND** SHALL keep AppShell interactive and expose an explicit retry
- **AND** SHALL NOT silently fall back to another engine、provider or model

### Requirement: Actual Engine Installation SHALL Use A Non-Blocking Progress Card

Only an actual CLI installer run MUST render in the existing bottom-right toast stack and MUST NOT dim or lock the application shell.

#### Scenario: Selected engine is already usable

- **WHEN** Product access、toolchain inspection/choice and activation complete without running `cli_install_run`
- **THEN** Doge SHALL continue the send without rendering checking、configuring、activating or ready UI
- **AND** internal readiness validation SHALL remain imperceptible to the user

#### Scenario: Engine installation is active

- **WHEN** send-triggered provisioning starts `cli_install_run` for the missing engine
- **THEN** Doge SHALL show the exact engine label and an installation progress indicator in a bottom-right card
- **AND** the rest of the App SHALL remain operable
- **AND** busy dismissal SHALL NOT orphan the transaction owner

#### Scenario: Engine becomes ready

- **WHEN** authoritative post-install verification and activation succeed after a visible installer run
- **THEN** the card SHALL show completion and dismiss after a bounded interval
- **AND** the queued send SHALL continue exactly once

#### Scenario: Engine installation fails

- **WHEN** provisioning returns a safe terminal failure
- **THEN** the card SHALL show localized failure copy with Retry and Dismiss actions
- **AND** raw secrets、absolute private paths and unbounded command output SHALL NOT be rendered

#### Scenario: Application update and engine provisioning overlap

- **WHEN** updater and engine provisioning cards are both visible
- **THEN** they SHALL stack in one shared host
- **AND** SHALL NOT overlap at the same fixed coordinates

### Requirement: Product Prepare SHALL Support Catalog-Only And Exact-Engine Modes

The Product prepare IPC MUST distinguish account/model bootstrap from exact-engine configuration and MUST validate scope before mutation.

#### Scenario: Prepare is called without an engine

- **WHEN** `account_product_v1_prepare` receives no `engineId`
- **THEN** Native MAY reconcile the Product Composite key and model catalog
- **AND** MUST NOT apply managed configuration for Codex、Claude Code or Kimi

#### Scenario: Prepare is called with an engine

- **WHEN** `account_product_v1_prepare` receives one valid Product `engineId`
- **THEN** Native SHALL apply managed configuration only for that engine
- **AND** MUST preserve unrelated local/custom providers and other Product engine configuration

#### Scenario: Prepare receives an unknown engine

- **WHEN** `engineId` is not `codex`、`claude-code` or `kimi`
- **THEN** Native SHALL fail with a stable validation error before vault or filesystem mutation
