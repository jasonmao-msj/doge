# shared-send-pipeline Specification

## Purpose
TBD - created by archiving change compose-shared-session-execution-target. Update Purpose after archive.
## Requirements
### Requirement: Send MUST Commit turnRequested Before Touching Runtime

The V2 send path MUST commit `conversation.turnRequested` (with the immutable `TurnExecutionSnapshot`) in the first transaction before any runtime side effect. The send path MUST thread `providerProfileId` from the selected target through snapshot, binding lookup, context compilation, delivery, and runtime dispatch. After Binding provisioning, it MUST compile a Context Package and commit `context.deliveryPrepared` plus durable pending delivery before importing context or sending a prompt.

#### Scenario: user intent is durable before runtime call

- **WHEN** a user submits a message in a shared session with V2 send enabled
- **THEN** `conversation.turnRequested` MUST be committed to the canonical log before the runtime is invoked
- **AND** the committed fact MUST carry the full target snapshot including provider profile

#### Scenario: provider profile id reaches runtime dispatch

- **WHEN** a turn targets a managed provider profile
- **THEN** context compilation and runtime dispatch MUST receive that `providerProfileId`
- **AND** the turn MUST NOT silently fall back to the disk/default provider

#### Scenario: unavailable target blocks send without rerouting

- **WHEN** the selected provider is unavailable or the model is outside the provider catalog
- **THEN** the send MUST be blocked with a target-unavailable state
- **AND** the system MUST NOT reroute to another provider or default model

#### Scenario: context intent precedes context side effect

- **WHEN** a Context Package is ready for import or prompt-prefix delivery
- **THEN** `context.deliveryPrepared` and matching pending delivery MUST commit before the Adapter call
- **AND** compile failure MUST produce no delivery side effect

### Requirement: Binding Provisioning MUST Be Durable and Crash-Safe

Binding provisioning MUST persist its state (`prepared → creating → ready / recovery-required`) in `shared_binding_state` before invoking the runtime. When the identity ACK is ambiguous, the binding MUST enter `recovery-required`; the system MUST NOT blindly create a second native session for the same target.

#### Scenario: provisioning state survives process kill

- **WHEN** the process is killed after provisioning is prepared but before the identity ACK
- **THEN** on restart the binding MUST be recoverable from its durable provisioning state
- **AND** the system MUST NOT create a duplicate native session for the same target

#### Scenario: ambiguous ack enters recovery-required

- **WHEN** the native session identity ACK is ambiguous (timeout, disconnect, or conflicting evidence)
- **THEN** the binding MUST transition to `recovery-required`
- **AND** the composer MUST offer probe or explicit rebuild instead of automatic retry

#### Scenario: explicit rebuild archives old binding

- **WHEN** the user explicitly rebuilds a `recovery-required` binding
- **THEN** the old binding metadata MUST be archived
- **AND** a new native session MUST be created while the shared session identity stays unchanged

### Requirement: Prompt Acceptance MUST Commit turnAccepted

The V2 send path MUST commit `conversation.turnAccepted` after the runtime's explicit prompt ACK. When the acceptance ACK is ambiguous, the session MUST enter `recovery-required`; the send path MUST NOT record acceptance and MUST NOT re-issue the prompt for the same attempt without probe resolution.

#### Scenario: explicit prompt ack commits turnAccepted

- **WHEN** the runtime explicitly acknowledges the prompt for a turn attempt
- **THEN** the send path MUST commit `conversation.turnAccepted` for that attempt
- **AND** the composer MUST transition from `awaiting-acceptance` to `running`

#### Scenario: ambiguous acceptance ack blocks silent retry

- **WHEN** the prompt acceptance ACK is ambiguous (timeout, disconnect, or conflicting evidence)
- **THEN** the session MUST enter `recovery-required`
- **AND** the system MUST NOT commit `turnAccepted` or send another prompt for the same attempt until probe resolution

### Requirement: Turn Commit MUST Follow Settled Ack With Idempotent Sink

A turn MUST only be committed as `conversation.turnCommitted` after the runtime's settled evidence, via the existing idempotent commit sink. Duplicate terminal evidence MUST NOT produce a second commit. Once prompt acceptance is durable, terminal observation MUST remain attached to the exact Runtime Attempt without an arbitrary full-Turn wall-clock deadline; an observer transport failure MUST NOT be treated as Runtime settlement.

#### Scenario: duplicate settled evidence commits once

- **WHEN** the same terminal `run.settled` evidence is delivered multiple times
- **THEN** exactly one `conversation.turnCommitted` fact MUST exist for that attempt
- **AND** the UI MUST show exactly one assistant final

#### Scenario: turn failure keeps snapshot without rerouting

- **WHEN** a turn fails on the selected target
- **THEN** the failure outcome MUST be committed against the original snapshot
- **AND** the system MUST NOT automatically retry on a different provider

#### Scenario: accepted turn outlives the former observer deadline

- **WHEN** an accepted Shared Turn remains active longer than any UI or IPC observation window
- **THEN** the exact Attempt MUST remain `running` until authoritative terminal evidence, explicit interrupt, or Runtime-ended evidence arrives
- **AND** desktop and daemon Provider event forwarders MUST continue forwarding that exact Turn until terminal or Runtime teardown
- **AND** elapsed wall-clock time alone MUST NOT mark its Binding `recovery-required`

#### Scenario: multiple observers wait on one active attempt

- **WHEN** the original terminal observer and a recovery reattachment both wait on the same exact Attempt
- **THEN** settlement or owner removal MUST wake every observer
- **AND** no observer MAY remain pending because another observer consumed the notification

#### Scenario: terminal observer transport detaches from an active attempt

- **WHEN** the terminal observer fails while durable evidence and the coordinator still identify an accepted active Attempt
- **THEN** the system MUST preserve the Runtime owner and frozen Target
- **AND** the observer failure MUST NOT create a failed, cancelled, or recovery terminal fact

### Requirement: Shared Composer MUST Follow the Nine-State UI Machine

The shared session composer MUST implement the nine-state machine: `idle`,
`preparing-context`, `degraded-context`, `awaiting-acceptance`, `cancel-pending`, `running`,
`settling`, `recovery-required`, `target-unavailable`. The picker MUST be locked in every
non-idle state except `target-unavailable`, where the user MUST be able to repair the Target.

The Shared Composer MUST distinguish text editing from Turn submission. During normal non-idle
progress (`preparing-context`, `degraded-context`, `awaiting-acceptance`, `running`, or
`settling`), the user MUST be able to edit and retain a draft while new Turn submission remains
blocked. Draft editing MUST NOT be interpreted as Queue or Steer. `cancel-pending` and
`recovery-required` MUST continue to lock the entire Composer because ordering is ambiguous.

The programmatic send boundary MUST acquire one per-Thread admission after asynchronous preflight
and before optimistic message, activity, or processing mutations. The returned mutation revision
MUST be consumed exactly once by the V2 orchestrator. A read-only state check alone MUST NOT be
treated as a concurrency lock.

#### Scenario: degraded context sends automatically with durable diagnostics

- **WHEN** context preparation produces a valid lossy projection with omissions
- **THEN** Shared Send MUST continue automatically with portable context and the current user
  request
- **AND** omissions, dispositions, compression, and projection mode MUST remain durable
  diagnostic facts
- **AND** the composer MUST NOT block on a continue/cancel confirmation
- **AND** compile failure, invalid ownership, ambiguous ACK, or Provider rejection MUST remain
  fail-closed

#### Scenario: ambiguous ack locks the whole shared session

- **WHEN** an acceptance or cancel ACK is ambiguous
- **THEN** the entire shared session composer MUST be locked in `cancel-pending` or `recovery-required`
- **AND** the session MUST NOT accept a next turn on any target until the ambiguity is resolved

#### Scenario: restart restores in-flight state

- **WHEN** the app restarts while a turn was `running`, `settling`, or `recovery-required`
- **THEN** the restored UI MUST resume the corresponding non-idle state from durable evidence
- **AND** the session MUST NOT silently reset to `idle`

#### Scenario: cancel pending reflects capability

- **WHEN** the user cancels during `awaiting-acceptance` and the adapter supports `cancelPendingDelivery`
- **THEN** the composer MUST enter `cancel-pending` until cancel ACK, terminal evidence, or probe resolution
- **AND** when the capability is unsupported the cancel action MUST be disabled with an explanation

#### Scenario: running turn blocks submit without disabling draft editing

- **WHEN** a Shared Turn is `running` or `settling`
- **THEN** the text editor MUST remain editable and MUST preserve the user's draft
- **AND** Enter, the send button, quick commands, and programmatic submit MUST NOT create a
  second Turn
- **AND** the draft MUST NOT enter Queue or Steer without an explicit future contract

#### Scenario: racing callers create only one optimistic turn

- **WHEN** two Shared V2 callers both pass an earlier idle preflight before either acquires the
  per-Thread admission
- **THEN** exactly one caller MUST consume the admission and reach optimistic UI or Runtime
- **AND** the losing caller MUST create no user bubble, processing mutation, or Runtime RPC

#### Scenario: terminal owner survives native thread rebind

- **WHEN** a terminal carries the exact Runtime Run identity but its `nativeThreadId` differs
  because the Binding was materialized or rebound
- **THEN** the terminal MUST settle that Run
- **AND** durable commit ACK MUST transition the Shared Composer back to `idle`
- **AND** a second Turn MUST then be submittable

#### Scenario: exact attempt owns terminal despite projected runtime identity drift

- **WHEN** a terminal carries the exact durable `attemptId` but its projected `runtimeTurnId` or
  `nativeThreadId` differs from stale frontend owner projection
- **THEN** exact Attempt ownership MUST settle the Turn
- **AND** secondary Runtime identity MUST NOT veto that durable identity match

#### Scenario: stop after canonical commit is idempotent

- **WHEN** the user presses Stop after the Attempt has already canonical committed but before the
  frontend clears its running projection
- **THEN** interrupt MUST return a typed `terminal-committed` ACK without requiring an active
  Runtime route
- **AND** the frontend MUST clear the active Attempt and return the Composer to `idle`
- **AND** it MUST NOT append a fabricated cancelled/stopped outcome

#### Scenario: committed Shared response cannot revive the native turn

- **WHEN** a Shared V2 send waits for Runtime terminal and canonical commit before its command
  response returns
- **THEN** the Shared caller MUST settle processing and return without executing the Native
  Session turn-start response handler
- **AND** it MUST NOT assign `activeTurnId` from the already completed Runtime response

#### Scenario: Shared dispatch terminal convergence is engine-neutral

- **WHEN** any Shared Runtime dispatch returns an accepted start ACK without a typed
  `run.settled`
- **THEN** the frontend MUST await the backend exact Attempt terminal contract
- **AND** backend MUST treat durable `conversation.turnCommitted` as the final completion proof
- **AND** a typed terminal already included in the response MAY be consumed as a fast path
- **AND** absence of an inline terminal MUST NOT be classified as ambiguous delivery
- **AND** Claude, Codex, and future Shared CLI adapters MUST use the same terminal convergence
  contract without Engine-specific branching

#### Scenario: missing frontend terminal event cannot strand a committed send

- **WHEN** Runtime terminal has been canonical committed for the exact Attempt
- **AND** the corresponding projected `app-server-event` is dropped, emitted before listener
  installation, or otherwise not observed by the frontend send subscriber
- **THEN** `shared_session_v2_await_turn_terminal` MUST return the durable committed outcome
- **AND** Shared Composer MUST transition through `runSettled` and `canonicalCommitted` to `idle`
- **AND** realtime events MAY still render content and play notifications but MUST NOT own control
  completion
- **AND** Native Session lifecycle MUST remain unchanged

#### Scenario: Shared logical terminal is not delayed by CLI cleanup

- **WHEN** a Shared-owned Claude Runtime emits a typed final `result`
- **AND** its process, hook, MCP child, stdout/stderr pipe, or usage probe is still cleaning up
- **THEN** the exact Shared Attempt MUST immediately normalize that result into terminal evidence
- **AND** backend durable settlement MUST NOT wait for cleanup `TurnCompleted` or process exit
- **AND** a later cleanup `TurnCompleted` MUST be absorbed exactly once without duplicate commit
  or duplicate assistant content
- **AND** success/error subtype, error code, stop reason, and final text MUST preserve their typed
  result semantics
- **AND** non-Shared Native Claude Session lifecycle MUST remain unchanged

#### Scenario: projected Shared start cannot reactivate Native lifecycle

- **WHEN** a projected `turn/started` event carries a valid Shared V2 owner
- **THEN** it MUST NOT invoke the generic Native Session turn-start lifecycle
- **AND** Shared assistant, reasoning, tool, error, and terminal projections MUST remain visible
- **AND** a non-Shared Native Session event MUST keep the existing lifecycle unchanged

#### Scenario: stop clears an idle Shared UI residue without native interruption

- **WHEN** Shared Send state is already `idle`, its active Attempt has been released, and only a
  stale frontend processing or active-turn projection remains
- **THEN** Stop MUST clear that matching Shared UI residue idempotently
- **AND** it MUST NOT call a Runtime interrupt or append a fabricated terminal outcome
- **AND** the same condition on a Native Session MUST continue through the existing Native
  interrupt contract unchanged

#### Scenario: stale restore cannot relock a completed turn

- **WHEN** a restore request starts before a complete send cycle and returns stale in-flight
  evidence after that cycle has durably committed
- **THEN** the stale response MUST NOT replace the current `idle` state with `running`
- **AND** the Composer MUST remain able to submit the next Turn

#### Scenario: ambiguous recovery locks the whole composer

- **WHEN** the Shared Send state is `cancel-pending` or `recovery-required`
- **THEN** text editing and Turn submission MUST both remain locked
- **AND** another Target MUST NOT bypass the unresolved linear ordering

#### Scenario: recovery probe uses durable owner evidence

- **WHEN** the user selects Probe for a recovery-required Shared Session
- **THEN** an unresolved Attempt MUST be queried by `attemptId`
- **AND** a recovery-only Binding MUST be queried by `bindingKey` before any unlock decision
- **AND** zero/multiple/unknown evidence or an RPC failure MUST keep the Session locked with a
  visible error

### Requirement: V2 Send MUST Be Feature-Flagged With V0 Rollback

The V2 send path MUST be the default Shared Session send path after Phase 2 rollout. The build-time `VITE_MOSSX_SHARED_V2_SEND` flag or local `mossx.sharedV2Send` override MUST allow an explicit negative value to select V0 rollback. An absent flag MUST NOT silently select V0. Rollback MUST NOT delete already-committed V2 facts.

#### Scenario: absent flag uses V2

- **WHEN** neither build flag nor local override is configured
- **THEN** Shared Session sends MUST use the V2 path
- **AND** the full selected Execution Target MUST reach runtime dispatch

#### Scenario: explicit flag off preserves V0 rollback

- **WHEN** the V2 send flag is explicitly disabled
- **THEN** Shared Session sends MUST use the V0 rollback path
- **AND** no V2 send-path state machine UI MUST be shown

#### Scenario: rollback keeps committed facts readable

- **WHEN** the flag is turned off after V2 turns were committed
- **THEN** previously committed canonical facts MUST remain intact in the event log
- **AND** the V0 read path MUST continue to work

### Requirement: Shared Send MUST Respect Context Acceptance Boundary

Shared V2 send MUST wait for runtime-specific context acceptance before prompt acceptance and MUST expose degraded projection details before any lossy delivery.

#### Scenario: lossy package waits for confirmation

- **WHEN** the Context Package Manifest contains omissions or lossy transformations
- **THEN** the composer MUST show mode, disposition, and compression details
- **AND** no context or prompt side effect MUST occur until the user confirms

#### Scenario: accepted context survives failed run

- **WHEN** context is accepted and the subsequent prompt/run fails
- **THEN** the accepted cursor MUST remain advanced
- **AND** a later attempt MUST compile only entries after that accepted boundary

### Requirement: Shared Follow-Up MUST Preserve Its Frozen Dispatch Envelope

A Shared queued follow-up MUST preserve `text`, `images`, per-item send options, the resolved Execution Target, and predecessor Attempt identity until dispatch. The queue MAY use existing client-store persistence, but its Runtime dispatch MUST still begin with the Shared V2 durable-first transaction.

#### Scenario: picker changes after enqueue

- **WHEN** a queued Shared follow-up was created and the mutable Picker later changes
- **THEN** the queued item MUST dispatch with its frozen CLI, Provider, Model, and Reasoning selection
- **AND** it MUST NOT read the new Picker value

#### Scenario: restart restores queued payload

- **WHEN** the app restarts after a Shared follow-up was queued but before it was dispatched
- **THEN** the queue MUST restore the complete serializable payload and frozen Target
- **AND** an invalid persisted envelope MUST fail closed instead of using the current Picker

### Requirement: Shared Runtime Outcome MUST Preserve Replaced Status

Shared Codex terminal normalization MUST read supported nested status shapes and preserve `replaced` as a distinct outcome. It MUST NOT infer success from the `turn/completed` method name alone.

#### Scenario: Codex completion carries nested replaced status

- **WHEN** Codex emits `turn/completed` with `params.turn.status=replaced`
- **THEN** the canonical Attempt outcome MUST be `Replaced`
- **AND** it MUST NOT be committed as `Completed`

### Requirement: Shared Manual Compaction MUST Resolve Durable Binding Owner

Manual compaction from a Shared thread MUST resolve engine, provider profile, Binding generation, and native session identity from durable Shared state. It MUST NOT infer the CLI from the logical Shared thread id.

#### Scenario: Shared Codex target requests manual compaction

- **WHEN** a Shared thread's durable selected Target and Binding identify Codex
- **THEN** manual compaction MUST target that exact provider-scoped native thread
- **AND** compaction lifecycle events MUST project to the logical Shared thread

#### Scenario: Shared unsupported target requests manual compaction

- **WHEN** a Shared thread's durable Target identifies an engine without compaction capability
- **THEN** the request MUST be rejected with an actionable capability reason
- **AND** it MUST NOT call a Codex or Claude runtime

### Requirement: V2 Runtime Dispatch MUST Be Attempt-Owned

The V2 dispatch boundary MUST identify an already-durable attempt and load its
`conversation.turnRequested.target` before any Runtime side effect. It MUST NOT call the V0 send
command or accept a second flat Engine/Provider/Model/Reasoning authority. The effective Binding
key MUST be Engine plus Provider Profile, and provider-specific failure MUST fail that Turn
without default fallback.

A Target-bearing `prepare_context` call MAY exist only as a read-only preview. The sole
Target-bearing mutation MUST be `begin_turn`; after it durably freezes the Target,
`prepare_delivery`, Runtime dispatch, Context/Prompt acceptance, commit, recovery, interrupt, and
rebuild routing MUST derive owner identity from the durable Attempt or Binding row. Frontend MUST
NOT submit independent acceptance facts.

#### Scenario: actual runtime follows durable target

- **WHEN** a Shared attempt durably selects Codex Provider A and runtime Model A
- **THEN** the observed Runtime process/session key and `turn/start.model` MUST correspond to
  Provider A and Model A
- **AND** mocked IPC parameter equality alone MUST NOT satisfy this acceptance criterion

#### Scenario: switching provider creates and reuses correct binding

- **WHEN** the user sends with Provider A, switches to Provider B, then switches back to Provider A
- **THEN** the first two Turns MUST use distinct Provider-keyed Bindings
- **AND** the third Turn MUST reuse Provider A's Binding
- **AND** no Turn may silently route through the Engine default Provider

#### Scenario: context preview has no mutation side effect

- **WHEN** the Composer previews Context fidelity for a complete Target
- **THEN** the preview MAY read canonical facts and existing Binding/Cursor evidence
- **AND** it MUST NOT create an Attempt or Binding, append a delivery fact, advance a Cursor, or
  invoke Runtime

#### Scenario: post-begin commands cannot restate target

- **WHEN** `conversation.turnRequested` has durably frozen Target A
- **THEN** delivery, dispatch, acceptance, commit, recovery, and interrupt command shapes MUST
  identify the Attempt without accepting a second Target
- **AND** stale flat Target B MUST have no way to override Target A

#### Scenario: typed dispatch ack conflicts with snapshot

- **WHEN** Runtime dispatch returns an Engine, Provider, runtime Model, Reasoning, or Binding that
  conflicts with the durable Attempt owner
- **THEN** the Attempt MUST fail closed or enter explicit recovery before `running`
- **AND** partial ACK equality MUST NOT be accepted as proof

#### Scenario: rebuild derives target from binding row

- **WHEN** a user explicitly rebuilds a recovery-required Binding
- **THEN** the command MUST accept only the durable `bindingKey` as routing identity
- **AND** Engine and Provider MUST be derived from and validated against the stored Binding row
- **AND** caller-supplied Target fields MUST NOT rewrite the Binding

### Requirement: Picker MUST NOT Provision Runtime Binding

Changing CLI, Provider, Model, or Reasoning in the Shared picker MUST update only
`selectedNextTarget`. Runtime Binding lookup or provisioning MUST begin only after a Turn snapshot
has been durably requested.

#### Scenario: picker change has no runtime side effect

- **WHEN** the user changes any Shared Target selector without sending
- **THEN** no native Thread, Provider process, Binding, or canonical Turn fact MUST be created

### Requirement: Runtime Lifecycle MUST Own Canonical Terminal Commit

The Runtime lifecycle owner MUST assemble authoritative terminal content before ordinary UI
fan-out, throttling, or delta drop. A terminal commit MUST preserve ordered assistant text,
Reasoning, Tool exchanges, Artifacts, omissions/private references, immutable Target, and
structured outcome. Frontend terminal observation MUST NOT be the canonical persistence source.

Events that arrive before exact Runtime identity binding MUST be retained and released through an
atomic Rust replay barrier. While the barrier is open, both early and newly arriving visible
events MUST remain ordered. Authoritative observation MUST be published before the corresponding
UI event. An exact Claude Context echo MAY update ACK state inside the barrier to avoid deadlock,
but MUST NOT let later visible events overtake earlier ones.

#### Scenario: terminal reload preserves rich content

- **WHEN** a Runtime terminal contains assistant text, Reasoning, Tool call/result, Artifact, and
  structured failure metadata
- **THEN** one idempotent canonical commit MUST persist those blocks with the attempt snapshot
- **AND** Shared history reload MUST reproduce their order and per-Turn CLI/Provider/Model label

#### Scenario: dropped streaming delta does not corrupt history

- **WHEN** an ordinary UI streaming delta is throttled or dropped but authoritative terminal
  evidence arrives
- **THEN** canonical history MUST reconstruct from terminal evidence
- **AND** `liveAssistantTextChannel` MUST remain externalized from the root reducer

#### Scenario: event arrives before runtime identity bind

- **WHEN** assistant, Reasoning, Tool, or terminal ingress arrives before the dispatch response
  exposes exact Runtime identity
- **THEN** Rust MUST retain the event, bind it to the durable Attempt, and replay it in arrival
  order
- **AND** an event arriving during replay MUST remain behind the existing barrier queue
- **AND** no frontend observer may become a second replay or persistence authority

#### Scenario: early context echo does not deadlock replay

- **WHEN** a Claude replay user-message containing the exact package/checksum marker arrives
  before visible replay drains
- **THEN** Context ACK waiting MUST be able to observe that marker
- **AND** assistant, Reasoning, Tool, and terminal events MUST still preserve replay order

#### Scenario: duplicate terminal is exactly once

- **WHEN** equivalent terminal evidence arrives before and after the replay barrier clears
- **THEN** the coordinator MUST retain one settlement and canonical commit
- **AND** the UI MUST render one assistant final

#### Scenario: equivalent Claude full observations are canonicalized once

- **WHEN** Claude Shared emits an equivalent cumulative/full assistant or reasoning observation
  more than once, including a duplicated terminal fallback
- **THEN** the Shared coordinator MUST retain one canonical copy of that semantic content
- **AND** it MUST preserve ordinary incremental fragments that add new content
- **AND** Codex Shared accumulation and Native Claude rendering MUST remain unchanged

#### Scenario: non-retry Codex error is terminal failure

- **WHEN** Codex emits an `error` ingress with `willRetry=false` before a later
  `turn/completed` transport notification
- **THEN** the Attempt MUST commit exactly once with outcome `failed`
- **AND** nested error message and code MUST be preserved as canonical failure metadata
- **AND** the later transport completion MUST NOT rewrite the outcome to `completed`

#### Scenario: interrupt error follows attempt cancel intent

- **WHEN** an attempt-owned interrupt intent is registered before Runtime emits a synchronous
  turn error
- **THEN** that terminal MUST settle as `cancelled`
- **AND** if the Runtime interrupt side effect itself fails, the intent MUST be cleared so a later
  real error remains `failed`

### Requirement: Shared V2 Projection MUST Be Canonical By Default

New V2 Shared Turns MUST render from canonical projection without requiring a local override.
Legacy Shared history MUST remain visible through explicit dual-read compatibility. Native
Session files MUST NOT be imported or concatenated into Shared history.

#### Scenario: reload shows immutable provenance without flag

- **WHEN** a V2 Shared Session is reloaded with no projection localStorage flag
- **THEN** every new Turn MUST retain its frozen CLI, Provider, Model, Reasoning, and outcome
- **AND** changing the current picker MUST NOT alter prior Turn labels

#### Scenario: legacy history remains visible

- **WHEN** a Shared Session contains legacy-only Turns plus new canonical Turns
- **THEN** the projection MUST preserve both sources without duplicate Turns
- **AND** unverifiable legacy Provider identity MUST remain “历史配置未知”

#### Scenario: reasoning-only or tool-only turn keeps provenance

- **WHEN** a completed Turn has no assistant text block but has Reasoning or Tool content
- **THEN** projection MUST preserve a non-visible provenance anchor carrying the immutable Target
- **AND** the Turn MUST still display its CLI, Provider, and Model label without fabricated text

#### Scenario: shared runtime prompt echo is presentation-only control

- **WHEN** Native Runtime replays the exact versioned Shared Context prompt envelope with matching
  package/checksum markers
- **THEN** presentation MUST hide only that duplicate user transport item
- **AND** the canonical user input and subsequent assistant, Reasoning, Tool, and Error content
  MUST remain visible
- **AND** ordinary user text that merely contains `MOSSX` MUST NOT be filtered

### Requirement: Shared Recovery Presentation MUST Have One Durable Owner

Shared Session recovery UI MUST be derived from the Shared Attempt/Binding state machine.
Conversation Canvas reuse MUST NOT activate Native Session reconnect actions for a Shared thread.
Native Session reconnect presentation MUST remain unchanged.

#### Scenario: shared runtime diagnostic does not create native recovery card

- **WHEN** a Shared thread contains a diagnostic that matches the Native runtime reconnect classifier
- **THEN** the Conversation Canvas MUST NOT render `RuntimeReconnectCard` for that diagnostic
- **AND** rebind, resend, or Native fork actions MUST NOT become available through that row

#### Scenario: shared recovery remains available through attempt owner

- **WHEN** durable Shared evidence resolves to `recovery-required`
- **THEN** `SharedSendStatusBar` MUST remain the visible recovery surface
- **AND** its Probe or explicit rebuild action MUST operate on the durable Attempt/Binding owner

#### Scenario: native reconnect behavior remains unchanged

- **WHEN** the same reconnect diagnostic belongs to a Native thread
- **THEN** the existing Native reconnect card and actions MUST remain available

### Requirement: Degraded Context Confirmation MUST Be Localized And Structured

The degraded-context gate MUST remain visible before any lossy context or prompt side effect.
Its primary summary and actions MUST use locale resources. Protocol details MUST be projected from
structured Manifest fields instead of concatenated backend display strings; known mode, omission
category/reason, disposition, outcome, and token labels MUST be localized.

#### Scenario: Chinese degraded summary explains portable behavior

- **WHEN** the active locale is Simplified or Traditional Chinese and a package has omissions
- **THEN** the primary summary MUST explain that compatible conversation content will still be sent while incompatible or private content cannot be transferred
- **AND** it MUST NOT expose known English protocol vocabulary such as `omissions`, `estimated tokens`, or `not-retrievable`

#### Scenario: continue and cancel actions remain explicit

- **WHEN** the composer enters `degraded-context`
- **THEN** the localized Continue and Cancel actions MUST remain visible
- **AND** no context or prompt side effect may occur until Continue is explicitly selected

#### Scenario: technical details are disclosed on demand

- **WHEN** the user opens degraded-context details
- **THEN** the UI MUST show localized projection mode, each structured omission, disposition, and token estimate
- **AND** an unknown protocol value MUST remain visible as a diagnostic fallback rather than being dropped or guessed

### Requirement: Same-Binding Continuation MUST NOT Behave Like Context Migration

Canonical facts already owned by the destination Native Binding MUST remain auditable as
`destination-owned`, but MUST NOT count as lossy context or require user confirmation. A package
with no portable delta MUST NOT inject an empty transcript marker or wait for a replay checksum.

#### Scenario: same target continues without degraded confirmation

- **WHEN** consecutive Shared turns use the same CLI, Provider, and Native Binding
- **AND** all source facts are already owned by that destination
- **THEN** context preparation MUST return `ready`
- **AND** the composer MUST NOT render the degraded-context confirmation

#### Scenario: zero-delta delivery preserves native continuation

- **WHEN** a prepared package has no portable entries
- **THEN** its `promptPrefix` MUST be empty
- **AND** the runtime MUST receive only the current user request
- **AND** context acceptance MUST use auditable `no-context-transfer-required` evidence without waiting for a checksum echo

#### Scenario: real loss remains gated

- **WHEN** the same package also contains an omission that cannot be reconstructed at the destination
- **THEN** the degraded-context confirmation MUST remain required
- **AND** benign `destination-owned` entries MUST NOT be presented as lost content

### Requirement: Shared Native Runtime Ownership MUST Precede Visible Fan-out

Native session identity MUST use one engine-specific canonical representation at the Runtime
coordinator boundary. A new Codex Native thread created for Shared dispatch MUST be held before
`thread/started` fan-out and MUST only be projected after exact Attempt binding.

#### Scenario: raw Claude UUID matches durable binding

- **WHEN** a Claude Runtime event reports raw session UUID `x`
- **AND** the durable Shared Binding identity is `claude:x`
- **THEN** the event MUST resolve to that Binding and Attempt
- **AND** terminal settlement MUST retain `claude:x` as the canonical native identity

#### Scenario: Claude providers remain isolated

- **WHEN** two Claude Providers emit the same raw session UUID
- **THEN** each event MUST resolve only inside its exact provider runtime scope
- **AND** neither Provider may settle or label the other Provider's Attempt

#### Scenario: first Codex turn stays hidden from native catalog

- **WHEN** Shared dispatch creates a Codex thread with no prior Native Binding
- **THEN** the provider-scoped provisioning owner MUST defer its `thread/started` fan-out
- **AND** exact binding MUST project that event to the Shared thread
- **AND** `list_shared_sessions` MUST include the V2 Binding native identity in its catalog exclusion projection
- **AND** no ordinary Native Session entry may be created for the hidden Binding before or after Sidebar refresh

#### Scenario: legacy metadata is not the hidden-binding authority

- **WHEN** a Shared V2 Binding exists in `shared_binding_state` but not in V0 `bindings_by_engine`
- **THEN** catalog exclusion MUST still hide its Native Session
- **AND** V0 metadata MAY only contribute compatibility identities, not replace V2 Binding state

### Requirement: Missing Native Binding MUST Enter Typed Recovery

A definitive Native session-not-found response MUST terminalize the current Attempt exactly once,
mark the affected Binding `recovery-required`, and return a typed recovery result. It MUST NOT be
shown as raw Provider diagnostics or trigger automatic retry, Provider fallback, or silent rebuild.

#### Scenario: stale Claude binding is recoverable

- **WHEN** Claude reports `No conversation found with session ID`
- **THEN** the current Attempt MUST have one failed canonical terminal
- **AND** its Binding MUST become `recovery-required` with reason `native-session-not-found`
- **AND** the Shared recovery status bar MUST be the only visible recovery surface

#### Scenario: terminal event races response error

- **WHEN** a failed Runtime terminal is committed before the command response exposes the same failure
- **THEN** the response path MUST reuse that terminal evidence
- **AND** it MUST NOT append a conflicting second `conversation.turnCommitted`

#### Scenario: recovery failure is not exposed as provider prose

- **WHEN** the typed Binding recovery result reaches the client
- **THEN** the send orchestrator MUST return `recovery-required` without throwing a raw error row
- **AND** all user-facing recovery actions and status text MUST use locale resources

### Requirement: Kimi Grok And OpenCode MUST Use The Shared V2 Durable Pipeline

Kimi CLI、Grok CLI and OpenCode CLI Shared turns MUST use the existing attempt-owned Shared
V2 pipeline. They MUST NOT bypass Tx1、Context Package、Provider-scoped Binding、typed
dispatch receipt、Runtime settlement or canonical commit.

#### Scenario: durable intent precedes newly supported runtime

- **WHEN** a Shared turn targets Kimi、Grok or OpenCode
- **THEN** `conversation.turnRequested` with the full frozen snapshot MUST commit before the
  Native runtime is touched
- **AND** dispatch MUST consume the durable Attempt owner rather than current picker state

#### Scenario: EngineEvent settles the exact Attempt

- **WHEN** a newly supported CLI emits text、reasoning、tool and terminal EngineEvents
- **THEN** events MUST enter the Shared Runtime coordinator under the exact Provider runtime key
- **AND** terminal evidence MUST settle and commit the matching Attempt exactly once

#### Scenario: receipt mismatch fails closed

- **WHEN** runtime receipt Engine、Provider、Model、Reasoning or runtime key differs from the
  durable target snapshot
- **THEN** Shared dispatch MUST enter a visible failure or recovery state
- **AND** MUST NOT accept the Turn or silently route to a default target

#### Scenario: unverified import uses weak user-channel delivery

- **WHEN** Context Package is delivered to Kimi、Grok or OpenCode
- **THEN** the pipeline MUST use user-channel transcript delivery with weak ACK evidence
- **AND** MUST NOT claim structured history import or strong context ACK

#### Scenario: native event remains native without shared owner

- **WHEN** Kimi、Grok or OpenCode emits an EngineEvent without a registered Shared Attempt owner
- **THEN** the existing Native Session event payload and fan-out MUST remain unchanged
- **AND** no Shared canonical fact MUST be created

### Requirement: Local Provider Runtime Key MUST Match Durable Attempt Identity

Every Shared-supported adapter MUST derive its local Provider Runtime key from the same canonical helper used by the durable Attempt target snapshot. Kimi and Grok local launch profiles MUST include the engine namespace, workspace identity, and canonical local Provider sentinel. Receipt validation MUST remain strict.

#### Scenario: Kimi local receipt matches the durable Attempt

- **WHEN** a Shared turn dispatches through the Kimi local Provider
- **THEN** the adapter receipt Provider Runtime key MUST equal the durable Attempt Provider Runtime key
- **AND** the turn MUST NOT enter `recovery-required` because of a workspace-only key

#### Scenario: Grok local receipt matches the durable Attempt

- **WHEN** a Shared turn dispatches through the Grok local Provider
- **THEN** the adapter receipt Provider Runtime key MUST equal the durable Attempt Provider Runtime key
- **AND** the turn MUST NOT enter `recovery-required` because of a workspace-only key

#### Scenario: mismatched receipt still fails closed

- **WHEN** any adapter returns a Provider Runtime key that differs from the durable Attempt owner
- **THEN** Shared dispatch MUST continue to reject the receipt as ambiguous
- **AND** the system MUST NOT accept aliases or engine-only fallback keys

### Requirement: Durable Shared Commit MUST Install an Exact-Turn Frontend Terminal Barrier

Shared V2 send 在 exact attempt 的 durable `conversation.turnCommitted` 返回后，MUST 使用
该 dispatch 的 `runtimeTurnId` 安装 frontend realtime terminal barrier，再释放 Composer
processing state。Frontend transient `turn/completed` MUST NOT 成为安装该 barrier 的必要条件。

#### Scenario: durable commit ends Composer without frontend terminal event

- **WHEN** Shared Runtime 已为 exact attempt durable commit `conversation.turnCommitted`
- **AND** frontend 没有收到对应的 `turn/completed`
- **THEN** Shared Composer MUST 回到 idle
- **AND** Stop control 与 active Turn MUST 被清除

#### Scenario: late realtime projection cannot revive committed turn

- **WHEN** exact Shared Turn 已经 durable committed
- **AND** 该 Turn 的 delayed `turn/started`、assistant delta、reasoning delta 或 item update
  在 commit 后到达
- **THEN** event MAY 补齐结算前已排队的展示内容
- **AND** event MUST NOT 把 processing 或 active Turn 重新设为运行中

#### Scenario: terminal barrier uses runtime identity

- **WHEN** Shared committed response 同时包含 attempt identity、logical identity 与
  `runtimeTurnId`
- **THEN** realtime terminal barrier MUST 使用 exact `runtimeTurnId`
- **AND** system MUST NOT 使用 `attemptId`、`logicalTurnId` 或当前 active target 冒充
  Runtime Turn identity

#### Scenario: next shared turn remains startable

- **WHEN** 上一个 Shared Turn 已通过 durable terminal barrier 结算
- **AND** 用户在同一 Shared Session 提交下一 Turn
- **THEN** 新 `runtimeTurnId` MUST 建立新的 processing lifecycle
- **AND** 上一 Turn 的 terminal barrier MUST NOT 丢弃新 Turn 的 realtime event

#### Scenario: provider choice does not change terminal behavior

- **WHEN** Claude Code Shared target 使用 Kimi、MiniMax 或其他可执行 Provider
- **THEN** durable terminal barrier MUST 使用同一 engine-neutral path
- **AND** frontend MUST NOT 通过 Provider 或 Model 名称决定是否结束 Composer

### Requirement: Binding Provisioning Is Durable Before Runtime Side Effects

Binding provisioning MUST persist its state (`prepared → creating → ready / recovery-required`) in `shared_binding_state` before invoking the runtime. When the identity ACK is ambiguous, the binding MUST enter `recovery-required`; the system MUST NOT blindly create a second native session for the same target.

For Shared-supported local CLIs, the durable `native_session_id` MUST converge to the identity used by native history listing so Hidden Binding hide filters can match:

- **Grok**: materialize MUST pre-assign a stable `grok:{uuid}` (or equivalent established identity) and first create MUST reuse that id instead of generating a divergent session id.
- **Kimi / OpenCode**: when the runtime finalizes a real session id after first create, the durable binding MUST be updated to that real id before the next list/hide cycle relies on it.

#### Scenario: crash during provisioning is recoverable

- **WHEN** the process crashes after binding provisioning is persisted but before runtime acceptance
- **THEN** on restart the binding MUST be recoverable from its durable provisioning state

#### Scenario: ambiguous identity ack enters recovery-required

- **WHEN** runtime identity acknowledgement is ambiguous for a binding operation
- **THEN** the binding MUST transition to `recovery-required`
- **AND** the system MUST NOT create another native session for the same target without explicit rebuild

#### Scenario: explicit rebuild archives old binding

- **WHEN** the user explicitly rebuilds a `recovery-required` binding
- **THEN** the old binding metadata MUST be archived

#### Scenario: grok binding identity matches disk session id

- **WHEN** Shared V2 materializes a Grok Hidden Binding and dispatches the first turn
- **THEN** the durable binding `native_session_id` MUST match the Grok session id that appears in native history listing (modulo the standard `grok:` prefix normalization)
- **AND** the system MUST NOT leave the binding stuck on a `grok-pending-shared-*` placeholder after a successful first create

#### Scenario: kimi or opencode binding rebinds to finalized session id

- **WHEN** Shared V2 dispatches a first turn on Kimi or OpenCode and the runtime later reports a finalized native session id
- **THEN** the durable binding MUST update `native_session_id` to that finalized identity
- **AND** subsequent Shared list responses MUST expose that identity in `nativeThreadIds` for hide filtering

### Requirement: Shared Target Availability MUST Stay Separate From Recovery

The V2 send path MUST block explicitly unavailable provider/model/runtime targets with `target-unavailable` and MUST keep the target picker switchable. It MUST NOT reroute to another provider or default model, and pure target unavailability MUST NOT become whole-session `recovery-required`.

#### Scenario: unavailable target blocks send without rerouting

- **WHEN** the selected provider is unavailable or the model is outside the provider catalog and there is no unresolved ambiguous attempt
- **THEN** send MUST be blocked with `target-unavailable`
- **AND** the user MUST be able to select another target and retry

### Requirement: Explicit Shared Rebuild MUST Stop Runtime Ownership First

When the user explicitly rebuilds a `recovery-required` binding, the old binding metadata MUST be archived and a new native session prepared only after unresolved Runtime ownership is released by stop/interrupt or terminal settlement.

#### Scenario: rebuild is refused while Runtime owns the attempt

- **WHEN** the user requests rebuild while Runtime still owns the unresolved attempt
- **THEN** rebuild MUST fail closed with a recovery-active class error
- **AND** the binding MUST NOT be archived until ownership is released
