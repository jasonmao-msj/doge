## MODIFIED Requirements

### Requirement: Streaming Schedule Tier MUST Be Selectable And Persisted

The webview MUST expose a `streamingScheduleTier` runtime flag with three allowed values: `baseline`, `guarded` (default), and `aggressive`. The flag MUST be persisted via `localStorage["ccgui.perf.streamingScheduleTier"]` and read through `resolveRenderScheduleTier()` (defined in the neutral owner `src/conversation-presentation/renderSchedulingPolicy.ts`). Invalid string values MUST fall back to `guarded` without throwing. Threads、Messages、Layout、App event consumers and tests MUST import the same neutral scheduling/flag owner so runtime and tests cannot instantiate divergent module state.

#### Scenario: default tier is guarded

- **WHEN** `localStorage["ccgui.perf.streamingScheduleTier"]` is unset
- **THEN** `resolveRenderScheduleTier()` MUST return `"guarded"`.

#### Scenario: invalid value falls back to guarded

- **WHEN** `localStorage["ccgui.perf.streamingScheduleTier"]` is `"invalid-tier"`
- **THEN** `resolveRenderScheduleTier()` MUST return `"guarded"`
- **AND** MUST NOT throw.

#### Scenario: aggressive tier applies tightened budgets

- **WHEN** the tier is `"aggressive"`
- **THEN** `MAX_DISPATCH_BUDGET_MS` MUST be 4 (not 8)
- **AND** the tool-output tail gate throttle MUST be 16ms (not 32ms)
- **AND** the `requestIdleCallback` timeout MUST be 25ms (not 50ms).

#### Scenario: all conversation consumers share one neutral flag singleton

- **WHEN** a test or runtime consumer resets or overrides a realtime performance flag
- **THEN** Threads、Messages、Layout and App event consumers MUST observe the same module state
- **AND** no feature-private compatibility copy or re-export shim MAY create a second cache
