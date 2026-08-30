# codex-provider-scoped-session-launch Specification

## Purpose
TBD - created by archiving change add-codex-provider-scoped-session-launch. Update Purpose after archive.

## Requirements

### Requirement: Codex Conversation Creation MUST Select A Provider Profile

The system MUST treat Codex provider selection as a new-conversation launch decision rather than a global active provider switch.

#### Scenario: disk configuration is the default provider profile

- **WHEN** the user opens the new Codex conversation creation affordance
- **THEN** the provider selector MUST include a default option representing the current disk `.codex` / `CODEX_HOME` configuration
- **AND** that option MUST preserve the existing Codex launch behavior when selected

#### Scenario: disk create-session auto-recovers before surfacing manual reconnect

- **WHEN** a new Codex conversation is created with no provider profile id or with `__disk__`
- **AND** the first create-session attempt fails because the managed runtime is recovering or because the just-started thread fails readiness confirmation
- **THEN** the client MUST automatically ensure the disk Codex runtime is ready and retry creation once
- **AND** it MUST only show the manual reconnect/retry notice if the retry still fails

#### Scenario: managed provider create-session does not use disk auto-recovery

- **WHEN** a new Codex conversation is created with a managed provider profile id
- **AND** the first create-session attempt fails
- **THEN** the client MUST NOT run default disk `ensureRuntimeReady` as a recovery shortcut for that managed provider
- **AND** it MUST preserve the existing provider-scoped creation error behavior

#### Scenario: provider selection is persisted with the created conversation

- **WHEN** a Codex conversation is created with a selected provider profile
- **THEN** the created thread metadata MUST record the provider profile id, source, and user-visible name
- **AND** later turns for that thread MUST use the persisted provider binding rather than the current UI selection

### Requirement: Codex Fork MUST Allow Provider Selection Without Mutating Parent Thread

The system MUST model provider switching as creating a forked child conversation with a selected provider, not as hot-swapping the parent conversation provider.

#### Scenario: fork defaults to inheriting parent provider

- **WHEN** the user opens the fork affordance for a Codex thread
- **THEN** the fork provider selector MUST default to the parent thread's provider profile
- **AND** the selector MUST also allow choosing the disk provider profile and available managed provider profiles

#### Scenario: fork child records selected provider

- **WHEN** the user forks a Codex thread and selects a provider profile
- **THEN** the parent thread metadata MUST remain unchanged
- **AND** the parent conversation MUST remain visible under its original thread id
- **AND** the frontend MUST NOT apply a rewind-style `renameThreadId(parent -> child)` or `hideThread(parent)` transition for provider-selected message forks
- **AND** the child thread metadata MUST record the selected provider profile id, source, and user-visible name
- **AND** later turns for the child thread MUST use the child thread's persisted provider binding

#### Scenario: fork to a different provider creates a native child with selected-provider binding

- **WHEN** the user forks a Codex thread and selects a provider profile different from the parent thread provider
- **AND** the parent runtime can fork the parent thread through the requested message anchor
- **THEN** the backend MUST send native `thread/fork` to the parent thread's provider runtime
- **AND** it MUST NOT create a fresh selected-provider thread by sending a transcript seed as a user message
- **AND** if the selected provider uses a different `CODEX_HOME`, it MUST make the native child history visible to that selected provider home before recording the child binding
- **AND** the child metadata MUST record the selected provider binding and a provider-rebind fork marker
- **AND** the parent thread metadata and visibility MUST remain unchanged

#### Scenario: cross-provider native fork fails visibly when child history cannot be rebound

- **WHEN** the user forks a Codex thread to a different provider
- **AND** the backend cannot validate the selected provider, cannot resolve the requested message anchor, cannot native-fork the parent runtime, or cannot make the native child history visible to the selected provider home
- **THEN** the fork MUST fail with a user-visible diagnostic containing workspace id, parent or child thread id when available, selected provider profile id, and the failed action
- **AND** it MUST NOT silently create a disk-provider child
- **AND** it MUST NOT hide or rename the parent thread

#### Scenario: fork to a different provider does not fallback silently

- **WHEN** the user forks a Codex thread to a selected managed provider
- **AND** that selected provider is unavailable or invalid
- **THEN** the fork MUST fail with a provider-unavailable or provider-invalid error
- **AND** it MUST NOT silently create the child thread with the disk provider profile

#### Scenario: unavailable parent provider blocks native fork

- **WHEN** a parent thread is bound to a provider that is no longer available
- **AND** the user attempts to fork the thread
- **THEN** the fork MUST fail with a provider-unavailable diagnostic
- **AND** it MUST NOT synthesize a transcript-seeded replacement conversation
- **AND** the parent thread MUST remain marked with its original unavailable provider binding

### Requirement: Managed Codex Providers MUST Use Provider-Scoped CODEX_HOME

The system MUST materialize managed provider configuration into an app-local provider-scoped Codex home and launch Codex app-server with that home.

#### Scenario: managed provider config is materialized without mutating global config

- **WHEN** a Codex conversation is created with a managed provider
- **THEN** the backend MUST write that provider's `configToml` into a provider-scoped `config.toml`
- **AND** it MUST write `authJson` into the same provider-scoped home when provided
- **AND** it MUST NOT overwrite the user's global `~/.codex/config.toml` or `~/.codex/auth.json`

#### Scenario: project configuration does not silently override selected managed provider

- **WHEN** a workspace has a project-level `.codex/config.toml`
- **AND** the user creates a Codex conversation with a managed provider
- **THEN** the system MUST ensure the selected managed provider's launch-critical provider/model settings are effective through explicit overrides or equivalent effective-config validation
- **AND** if the selected managed provider would be overridden, the system MUST block thread creation with a user-visible conflict error
- **AND** it MUST NOT create a thread that appears bound to the managed provider while Codex actually uses the project configuration

#### Scenario: managed provider runtime receives scoped CODEX_HOME

- **WHEN** the backend starts Codex app-server for a managed provider profile
- **THEN** the child process MUST receive `CODEX_HOME` pointing at that provider-scoped home
- **AND** the runtime MUST NOT read credentials from another managed provider's scoped home

#### Scenario: sensitive provider files are protected

- **WHEN** the backend writes provider-scoped `auth.json`
- **THEN** it MUST avoid logging raw secret values
- **AND** it SHOULD apply owner-only file permissions where the platform supports them

#### Scenario: provider homes persist across app restarts

- **WHEN** a managed provider has been used to create Codex conversations
- **AND** the app restarts
- **THEN** the provider-scoped home MUST remain available as an app-local artifact
- **AND** the backend MUST be able to rediscover provider-bound history from that provider home

### Requirement: Provider-Scoped Codex Runtimes MUST Be Isolated

The system MUST isolate Codex runtime sessions by workspace and provider profile so multiple providers can run concurrently.

#### Scenario: thread-bound provider binding lookup prefers canonical catalog metadata

- **WHEN** a thread-bound Codex operation resolves provider metadata for `workspaceId` and `threadId`
- **THEN** the backend MUST first look up the canonical catalog key `codex:<workspaceId>:<threadId>`
- **AND** it MAY fall back to legacy keys such as `codex::<workspaceId>::<threadId>`, `<threadId>`, and `codex:<threadId>`
- **AND** blank `threadId` MUST NOT produce a metadata lookup key
- **AND** missing metadata MAY default to the disk provider only for legacy compatibility
- **AND** an existing non-disk canonical binding MUST NOT be bypassed by a legacy disk binding.

#### Scenario: disk thread start confirms readiness without changing managed providers

- **WHEN** backend `thread/start` returns a thread id for the disk provider profile
- **THEN** the backend MUST perform a bounded readiness confirmation against the same disk runtime before returning success to the caller
- **AND** readiness confirmation failure MUST be surfaced as a create-session failure rather than marking the UI thread as loaded
- **AND** the same confirmation MUST NOT be applied to managed provider `thread/start` calls unless a future spec explicitly enables it

#### Scenario: app-server capability probe reuses successful evidence safely

- **WHEN** Codex app-server capability has recently been successfully probed for the same resolved binary, PATH environment, codex args, and launch options
- **THEN** subsequent runtime starts MAY reuse that successful probe evidence within a bounded TTL
- **AND** failed probes MUST NOT be cached as blocking evidence
- **AND** probe reuse MUST NOT collapse distinct managed provider launch args or wrapper launch modes

### Requirement: Codex Supplier Management MUST Not Expose Misleading Global Enablement

The Codex supplier management tab MUST manage reusable provider profiles and MUST NOT imply that one provider is globally active for all Codex sessions.

#### Scenario: provider cards do not offer global enable

- **WHEN** the user views Codex providers in supplier management
- **THEN** managed provider cards MUST NOT show an action that globally enables that provider for all Codex sessions
- **AND** the UI SHOULD describe providers as available for new conversation creation

#### Scenario: existing management actions remain available

- **WHEN** the user views a managed Codex provider card
- **THEN** edit, delete, and custom model management actions MAY remain available
- **AND** those actions MUST NOT change provider binding for already-created conversations unless a future explicit migration action is introduced

#### Scenario: editing a provider affects future runtimes only

- **WHEN** a managed Codex provider is edited while a runtime using the previous configuration is already running
- **THEN** the running runtime MUST NOT be silently hot-swapped to the edited configuration
- **AND** newly spawned runtimes for that provider MUST use the latest saved provider configuration

### Requirement: Codex Provider Selection MUST Cover All New Conversation Entrypoints

All user-visible and programmatic Codex conversation creation entrypoints MUST either expose provider selection or explicitly use the disk default profile.

#### Scenario: visible creation entrypoints share the same provider selector behavior

- **WHEN** the user creates a new Codex conversation from any visible entrypoint such as sidebar action, empty state action, command action, or keyboard-driven creation
- **THEN** the creation flow MUST use the same provider selection contract
- **AND** the default selection MUST be the disk `.codex` provider profile

#### Scenario: non-interactive creation defaults or passes provider explicitly

- **WHEN** a non-interactive or programmatic path creates a Codex conversation
- **THEN** it MUST either pass an explicit provider profile id
- **OR** it MUST intentionally default to the disk `.codex` provider profile
- **AND** that choice MUST be visible in the created thread metadata

### Requirement: Codex Conversation Surfaces MUST Show Provider Label

The system MUST make the provider binding for each Codex conversation visible enough for users to distinguish sessions while disk and managed-provider conversations run in parallel.

#### Scenario: conversation list shows provider label

- **WHEN** the user views Codex conversations in the sidebar, session list, or equivalent conversation list
- **THEN** each Codex conversation SHOULD show a provider label derived from thread metadata
- **AND** disk, managed, and unavailable providers MUST be distinguishable

#### Scenario: active conversation shows provider label

- **WHEN** the user opens a Codex conversation
- **THEN** the active conversation surface SHOULD show the bound provider label in the header, metadata area, or equivalent prominent location
- **AND** the label MUST NOT be computed from a global active supplier state

#### Scenario: frontend preserves provider metadata across thread updates

- **WHEN** Codex thread metadata enters the frontend through start response, catalog projection, live turn events, sidebar snapshots, or fork response
- **THEN** the frontend MUST preserve `providerProfileId`, `providerProfileSource`, `providerProfileName`, `providerAvailability`, and `sourceLabel` when present
- **AND** later thread update actions that omit provider fields MUST NOT erase existing provider metadata
- **AND** sidebar, pinned list, and composer provider labels MUST derive from thread metadata rather than supplier-management active state

### Requirement: Codex Runtime Isolation Claims MUST Distinguish Provider Scope From Thread Process Scope
Codex runtime isolation claims MUST distinguish provider-scoped process/config isolation from per-thread process isolation.

#### Scenario: provider-scoped isolation is evaluated
- **WHEN** a change claims Codex runtime isolation for managed providers
- **THEN** the claim MUST be evaluated against provider-scoped `CODEX_HOME`, provider runtime key, persisted provider binding, and thread routing correctness
- **AND** it MUST NOT require one app-server process per thread unless a later behavior spec explicitly introduces that requirement

#### Scenario: per-thread process isolation is requested
- **WHEN** a user or artifact asks for per-thread Codex app-server process isolation
- **THEN** the system MUST treat it as a new behavior requirement requiring a separate proposal, design, risks, and validation plan
- **AND** it MUST NOT be retroactively treated as missing work for the existing provider-scoped runtime contract

### Requirement: Concurrent Codex Conversations MUST Not Collide Through Frontend Fallback

Concurrent Codex conversations, including same-provider conversations that reuse a provider-scoped runtime, MUST keep frontend lifecycle and progress events isolated by thread and turn ownership. Runtime sharing, provider binding, or active UI selection MUST NOT allow one conversation to consume another conversation's lifecycle signal.

#### Scenario: same-provider concurrent events require owner proof
- **WHEN** two Codex conversations using the same provider profile are processing concurrently in the same workspace
- **AND** frontend receives a lifecycle-sensitive event without explicit thread or turn owner
- **THEN** frontend MUST NOT settle, start, revive, or record liveness progress for whichever conversation is currently active or visible
- **AND** neither conversation MUST consume the event solely because it shares the provider runtime

#### Scenario: different-provider concurrent events require owner proof
- **WHEN** two Codex conversations using different provider profiles are processing concurrently in the same workspace
- **AND** frontend receives a lifecycle-sensitive event without explicit thread or turn owner
- **THEN** frontend MUST NOT infer owner from the globally selected provider, the active conversation provider, or the most recently used provider profile
- **AND** the event MUST remain diagnostic-only unless a safe explicit owner or bounded unique fallback exists

#### Scenario: explicit thread owner preserves provider-scoped routing
- **WHEN** frontend receives a Codex event with explicit affected thread context
- **THEN** event handling MUST follow the affected thread identity and its persisted provider binding
- **AND** it MUST NOT infer provider or conversation ownership from global active Codex supplier state

#### Scenario: unique processing conversation may receive bounded fallback
- **WHEN** exactly one Codex conversation in a workspace is processing
- **AND** a lifecycle-sensitive event lacks explicit affected context
- **THEN** frontend MAY route the event to that unique processing conversation as bounded fallback
- **AND** fallback MUST NOT change provider binding or route through another provider profile

### Requirement: Provider-Scoped Codex Parallelism MUST Preserve Session Identity

Provider-scoped Codex runtime reuse MUST preserve per-conversation session identity. A runtime key or provider profile key is not sufficient to identify the lifecycle owner of a frontend event.

#### Scenario: provider runtime key is not an event owner
- **WHEN** multiple Codex threads share the same workspace/provider runtime key
- **THEN** frontend MUST treat the runtime key as insufficient owner context for lifecycle mutation
- **AND** it MUST require thread/turn owner proof or a unique processing fallback

#### Scenario: provider metadata survives event ownership hardening
- **WHEN** a Codex thread has persisted provider metadata
- **AND** the ownership resolver routes an explicit event to that thread
- **THEN** the mutation MUST preserve the thread's provider metadata
- **AND** the event gate MUST NOT rewrite the thread as disk-provider or another managed provider thread

#### Scenario: provider-selected continuation remains thread-bound
- **WHEN** the user continues, resumes, compacts, rewinds, or forks a Codex thread with persisted provider binding
- **THEN** the operation MUST remain routed by that thread binding
- **AND** ownership hardening MUST NOT introduce a global provider fallback that changes the target conversation

### Requirement: Shared-Session Native Rebinding MUST Remain Explicit And Unique

Shared-session native thread rebinding MUST continue to rely on explicit native/shared binding facts. Ownership hardening MUST not replace unique shared-session binding logic with active thread or active provider inference.

#### Scenario: explicit native thread binding routes to shared thread
- **WHEN** a lifecycle event includes a native thread id that is registered for a shared-session thread
- **THEN** frontend MUST route lifecycle mutation to the shared thread id
- **AND** the engine hint from the binding MUST be preserved

#### Scenario: pending native binding must remain unique
- **WHEN** frontend resolves a pending shared-session binding by engine
- **THEN** it MUST only use a unique pending binding
- **AND** multiple pending bindings for the same engine MUST be treated as ambiguous

#### Scenario: shared-session rebinding cannot mask Codex parallel ambiguity
- **WHEN** two Codex shared-session conversations are pending or processing concurrently
- **AND** an event lacks native thread identity and lacks unique pending binding
- **THEN** frontend MUST NOT route the event to the active shared thread
- **AND** the event MUST NOT mutate either shared conversation's lifecycle state by guess

### Requirement: Codex Provider Custom Models MUST Feed Model Catalog

Custom models stored on managed Codex provider profiles MUST be treated as model catalog facts for composer selection. Adding, editing, loading, or deleting Codex providers MUST update the composer-visible Codex custom model catalog without requiring an app restart.

#### Scenario: provider custom model appears after provider add
- **WHEN** the user creates a managed Codex provider with `customModels`
- **THEN** those custom models MUST become visible in the Codex model selector catalog
- **AND** the update MUST NOT trigger Codex runtime reload

#### Scenario: provider custom model appears after provider edit
- **WHEN** the user edits a managed Codex provider and changes `customModels`
- **THEN** the Codex model selector catalog MUST reflect the provider custom model additions
- **AND** it MUST deduplicate them against existing global custom model entries by model id

#### Scenario: provider management is not active runtime switch
- **WHEN** the user adds, edits, or deletes a managed Codex provider profile
- **THEN** existing Codex conversations MUST keep their thread-bound provider runtime
- **AND** provider management MUST NOT switch or restart the active runtime as a side effect

### Requirement: Codex Composer First Send MUST Preserve Selected Provider Origin

When Composer creates a new Codex conversation from a selected model that carries managed provider origin metadata, the creation request MUST use that provider profile instead of silently falling back to the disk provider.

#### Scenario: selected managed custom model starts provider-bound conversation

- **WHEN** the user selects a Codex custom model whose selector option carries `providerProfileId`
- **AND** the user sends the first message with no active Codex thread
- **THEN** the frontend MUST pass that `providerProfileId` to the Codex thread creation path
- **AND** the created conversation MUST use the selected managed provider binding

#### Scenario: provider origin is absent

- **WHEN** the user selects a Codex model whose selector option does not carry `providerProfileId`
- **AND** the user sends the first message with no active Codex thread
- **THEN** the frontend MUST NOT infer provider binding from model id alone
- **AND** the creation path MUST preserve the existing disk/default provider behavior

#### Scenario: active provider-bound thread continues using thread metadata

- **WHEN** the user sends a message in an existing Codex thread
- **THEN** the send path MUST continue resolving provider binding from thread metadata and backend recovery rules
- **AND** Composer's current model option MUST NOT override the existing thread provider binding

### Requirement: Disk Codex Create Loading MUST Represent First Send Readiness

Codex disk create-session loading MUST only settle as ready when the disk session has the runtime and native thread readiness needed for an immediate first `sendMessage`, or MUST settle into a bounded recovering or failed state with actionable copy.

#### Scenario: disk loading completion permits first send
- **WHEN** the user creates a new Codex conversation with no provider profile id or with `__disk__`
- **AND** the create-session loading state completes successfully
- **THEN** the created conversation MUST be ready for the first `sendMessage` without requiring a second hidden runtime recovery step
- **AND** the composer/send readiness state MUST NOT claim readiness while the just-created disk thread binding is known stale, stopping, or unconfirmed

#### Scenario: disk readiness failure does not masquerade as loaded
- **WHEN** disk create-session receives a native thread id but same-runtime readiness confirmation fails, the runtime is stopping, or the binding is reported missing before first send readiness
- **THEN** the create-session flow MUST NOT present the session as fully loaded
- **AND** it MUST either continue a bounded recovering state or surface an actionable retry/reconnect failure

#### Scenario: managed provider creation remains unchanged
- **WHEN** a new Codex conversation is created with a managed provider profile id
- **THEN** disk-only readiness hardening MUST NOT run default disk runtime recovery, disk readiness confirmation, or disk fallback for that managed provider
- **AND** the existing managed provider-scoped creation behavior MUST be preserved

#### Scenario: Claude Code creation remains out of scope
- **WHEN** the user creates or resumes a Claude Code session
- **THEN** Codex disk loading hardening MUST NOT change Claude Code runtime acquisition, session creation, recovery, or user-facing copy

### Requirement: One-click Codex creation remembers the last valid provider

One-click Codex session creation MUST 记忆最近一次用户明确选择且仍可用的 provider profile，并 MUST 将该选择仅用于未来新会话。

#### Scenario: Create another Codex session

- **WHEN** 用户此前选择 managed provider 创建会话且该 provider 仍存在
- **THEN** 下一次 one-click creation MUST 默认使用该 provider，同时保持用户可切换

#### Scenario: Remembered provider was removed

- **WHEN** 最近 provider 已删除或不可用
- **THEN** one-click creation MUST 回退到 disk/default provider contract，且不得改变既有 thread binding

### Requirement: Codex User Fork MUST Be A Top-Level Sidebar Conversation

系统 MUST 将用户主动创建的 Codex Fork 作为独立顶层 conversation 投影；native `thread/fork` 返回的 lineage MUST NOT 被 frontend generic Subagent relationship store 解释为 Subagent ownership。

#### Scenario: Codex fork is visible without expanding parent
- **WHEN** 用户从 Codex conversation 创建 Fork
- **THEN** parent 与 forked conversation MUST 在 Sidebar 顶层并列可见
- **AND** forked conversation MUST NOT 显示 `子代理` 标签

#### Scenario: Codex fork does not mutate real subagent projection
- **WHEN** workspace 同时包含 user-created Codex Fork 与 engine-created Codex Subagent
- **THEN** 只有 engine-created Subagent MUST 嵌套于其 parent
- **AND** user-created Fork MUST 保持顶层会话

### Requirement: Codex managed provider protocol incompatibility fails before runtime launch

Codex managed provider create-session MUST validate every configured model provider `wire_api` before materializing or launching app-server because Codex parses the complete provider map during config loading. When any configured wire protocol is unsupported by the current Codex integration, backend MUST return a stable non-secret diagnostic marker and frontend MUST present localized actionable guidance instead of a raw transport error.

#### Scenario: effective provider uses unsupported chat wire protocol

- **WHEN** a selected Codex managed provider declares top-level `model_provider = "<provider-id>"` and `[model_providers.<provider-id>].wire_api = "chat"`
- **THEN** create-session MUST fail before spawning Codex app-server
- **AND** backend error MUST contain stable marker `[codex_provider_wire_api_unsupported]`
- **AND** user-facing copy MUST explain that current Codex CLI does not support `wire_api = "chat"`
- **AND** user-facing copy MUST distinguish direct Responses API configuration from a required protocol conversion/router
- **AND** user-facing copy MUST NOT contain `Broken pipe` or raw OS error codes
- **AND** frontend MUST use the global custom sticky Error Toast instead of native `window.alert`

#### Scenario: effective provider uses responses wire protocol

- **WHEN** a selected Codex managed provider declares `wire_api = "responses"` for its effective provider
- **THEN** protocol preflight MUST allow the existing runtime launch flow to continue unchanged

#### Scenario: wire protocol is omitted

- **WHEN** a selected Codex managed provider omits `wire_api` or has no resolvable top-level `model_provider`
- **THEN** this protocol preflight MUST NOT invent a compatibility failure
- **AND** the existing Codex config parser and runtime error behavior MUST remain authoritative

#### Scenario: unselected provider table uses chat

- **WHEN** `configToml` contains an unselected provider table with `wire_api = "chat"` but the effective top-level `model_provider` selects a different provider
- **THEN** protocol preflight MUST reject the configuration before runtime launch
- **AND** diagnostic detail MUST identify the incompatible provider table without exposing credentials

#### Scenario: managed provider configuration is invalid TOML

- **WHEN** Codex managed provider `configToml` cannot be parsed, including values using non-ASCII smart quotes
- **THEN** backend MUST return stable marker `[codex_provider_config_invalid]`
- **AND** frontend MUST show localized guidance through the global custom sticky Error Toast
- **AND** user-facing copy MUST recommend checking TOML syntax and English half-width quotes
- **AND** user-facing copy MUST NOT include raw parser stack, source excerpt, credentials, or native `window.alert`

### Requirement: Managed Codex Restore MUST Rehydrate And Verify Its Toolchain

应用重启后，managed Codex provider 的 engine restore MUST 从现有 bundled/external toolchain
重新 resolve 并 verify；通过验证后 MUST 使用 `account_engine_v1_activate`，不能把 managed
runtime 当作普通 disk engine 走 generic `switch_engine`。

#### Scenario: managed Codex binary cache is cold after restart

- **WHEN** persisted active engine 是 managed Codex，且当前 Rust process 没有 binary cache
- **THEN** restore MUST resolve 当前 bundled/external selected binary 并完成 verification
- **AND** verified binary MUST 被重新放入 launch cache 后再激活

#### Scenario: managed restore activation succeeds

- **WHEN** managed Codex toolchain resolve 与 verification 成功
- **THEN** restore MUST call `account_engine_v1_activate("codex")`
- **AND** MUST NOT call generic `switch_engine("codex")` as the managed activation boundary

#### Scenario: managed restore verification fails

- **WHEN** managed binary missing、resolve 失败或 verification 失败
- **THEN** restore MUST fail closed with a diagnostic/recovery state
- **AND** MUST NOT silently replace the managed target with disk/global Codex configuration
