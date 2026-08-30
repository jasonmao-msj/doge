## ADDED Requirements

### Requirement: Product Claude Models MUST Be Callable Through Codex Responses

Doge SHALL expose a Claude-family Product model to Codex only when the `Doge APP` Composite owns an enabled Responses→Anthropic route and the real managed Codex payload has authoritative terminal evidence.

#### Scenario: Claude is routed to Codex
- **GIVEN** `Doge APP` has an enabled `claude-*` prefix route from Responses to Anthropic with raw-model passthrough
- **WHEN** Codex sends a managed Product turn using `claude-opus-4-8`
- **THEN** token2api SHALL route the exact requested Claude model to the Anthropic target
- **AND** Codex SHALL receive a completed typed terminal with the requested runtime model attribution

#### Scenario: Route or runtime is unavailable
- **WHEN** the exact route is missing、disabled or rejects the real Codex Agent payload
- **THEN** the target SHALL remain unavailable or return its exact typed failure
- **AND** Doge MUST NOT silently select another engine、model or provider

### Requirement: Product Catalog MUST Project Verified Claude Protocols Once

Native SHALL normalize a metadata-absent verified Claude-family row to Responses and Messages, and every Renderer consumer SHALL use the single resulting Product target catalog.

#### Scenario: Metadata-absent Claude family has verified Responses route
- **GIVEN** a Claude/Anthropic Product row has no explicit protocol metadata
- **AND** Messages and Responses compatibility have exact production evidence
- **WHEN** Native normalizes the row
- **THEN** canonical `api_protocols` SHALL be `openai-responses` and `anthropic-messages`
- **AND** the row SHALL appear under Codex and Claude but not Kimi

#### Scenario: Explicit upstream protocol metadata narrows a row
- **WHEN** an upstream row supplies recognized `api_protocols`、`supported_protocols` or `protocols`
- **THEN** explicit values SHALL remain authoritative
- **AND** Doge MUST NOT re-add Responses from family fallback

#### Scenario: Product consumers render one row set
- **WHEN** the canonical target catalog contains the cross-protocol Claude row
- **THEN** Home、existing Native picker、Shared、Panel/Kanban、target repair and send-time validation SHALL consume that same row
- **AND** no consumer SHALL recalculate compatibility from model names

### Requirement: Managed Codex Configuration MUST Converge For Fresh And Upgraded Clients

The deterministic `doge-token-matrix` projection SHALL carry the current managed revision and SHALL converge before managed Codex creates a Session、Binding or Turn.

#### Scenario: Fresh user sends through Codex
- **WHEN** a clean client first sends a Codex Product target
- **THEN** exact-engine prepare SHALL create the current managed provider projection automatically
- **AND** the user SHALL NOT need Engine Management、global CLI edits or login-time engine setup

#### Scenario: Revision-one user upgrades
- **GIVEN** the same-id managed Codex entry is missing current revision or has revision 1
- **WHEN** the upgraded app selects managed Codex for send
- **THEN** exact-engine prepare SHALL replace the stale entry before any Session/Binding/Turn side effect
- **AND** unrelated local/custom providers and existing Session bindings SHALL remain unchanged

#### Scenario: Current projection is prepared repeatedly
- **WHEN** managed Codex is prepared repeatedly at current revision
- **THEN** the deterministic result SHALL remain equivalent
- **AND** no provider row SHALL be duplicated or user-owned sibling mutated

#### Scenario: Login performs catalog-only reconciliation
- **WHEN** authenticated startup prepares only catalog/credential state
- **THEN** AppShell SHALL remain mounted regardless of engine configuration outcome
- **AND** exact Codex config/toolchain convergence SHALL remain at frozen send boundary

### Requirement: Cross-Protocol Codex Evidence MUST Use A Real Native Turn

Claude-model availability in Codex SHALL require a real managed Codex turn in addition to route and minimal Responses probes.

#### Scenario: Codex uses Claude
- **WHEN** Doge launches managed Codex with `claude-opus-4-8`
- **THEN** evidence SHALL include the real Codex system/tools/stream Agent payload、requested runtime model and one completed typed terminal
- **AND** a minimal Responses 200 alone SHALL NOT satisfy acceptance

#### Scenario: Codex reports a structured rejection
- **WHEN** the real cross-protocol Codex turn completes failed
- **THEN** Doge SHALL settle exactly once with the exact target failure visible
- **AND** catalog or route presence SHALL NOT override that negative evidence
