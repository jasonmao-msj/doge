## ADDED Requirements

### Requirement: Squad Run MUST Be Conversation-Native And Shared-Session Scoped
The system MUST create a Squad Run only from an explicit Shared Session request and MUST allow at most one non-terminal Squad Run per Shared Session.

#### Scenario: explicit shared squad request
- **WHEN** the user sends a Shared Session message with one-shot Squad mode armed
- **THEN** the system appends a durable run-request fact associated with that Shared Session and begins Lead planning

#### Scenario: second active run is rejected
- **WHEN** a Shared Session already has a non-terminal Squad Run and another run is requested
- **THEN** the system returns a stable conflict without creating another run or touching a CLI runtime

#### Scenario: native conversation is not eligible
- **WHEN** a native engine conversation submits the same request mode
- **THEN** the system fails closed and does not create Squad facts

#### Scenario: target lacks hard read-only mode
- **WHEN** the current Shared target adapter cannot hard-enforce read-only Lead and Worker execution
- **THEN** admission fails before any Lead runtime side effect; V1 supports Codex and Claude targets only

### Requirement: Agent Plan Proposal MUST Not Own Execution Authority
The system MUST treat model output as an untrusted plan proposal and MUST allow only mossx validation and canonical state transitions to authorize execution.

#### Scenario: valid proposal enters approval state
- **WHEN** Lead output normalizes to a valid `SquadPlanProposalV1`
- **THEN** the system appends `SquadPlanProposed` and exposes an editable approval surface without dispatching Worker nodes

#### Scenario: prose cannot drive state
- **WHEN** Lead prose claims that a node is running or completed without a valid typed plan or canonical fact
- **THEN** the system retains the prose as transcript evidence and does not change Squad state

#### Scenario: invalid structured output fails closed
- **WHEN** normalization and one bounded JSON-only repair still fail domain validation
- **THEN** the planning attempt becomes visibly failed and no partially trusted plan is persisted

### Requirement: Squad Plan MUST Pass Complete Validation Before Approval
The system MUST validate DAG structure, identities, budgets, the exact sealed Lead target, permissions, verification policy, and final synthesis before appending plan approval.

#### Scenario: cyclic plan is rejected
- **WHEN** a proposed plan contains a dependency cycle
- **THEN** approval fails before any Worker or workspace side effect and identifies the cycle as a validation error

#### Scenario: target differs from sealed Lead target
- **WHEN** a node target differs from the Composer target sealed for Lead planning
- **THEN** approval fails closed without silently substituting another Engine, Provider, Model, Reasoning, or local provider

#### Scenario: mutation target lacks enforced workspace sandbox
- **WHEN** a Mutate node targets an Engine whose ordinary CLI adapter cannot hard-enforce the current-workspace write boundary
- **THEN** approval fails closed; V1 admits Mutate only through the Codex workspace sandbox path

#### Scenario: verifier requests mutation authority
- **WHEN** a Verify node declares a permission class other than read-only
- **THEN** plan validation rejects the node

#### Scenario: budget exceeds envelope
- **WHEN** node budgets exceed the proposed total budget or a configured hard ceiling
- **THEN** approval is rejected before the plan is sealed

### Requirement: Approved Plan MUST Be Sealed After One User Confirmation
The system MUST seal the approved plan revision, exact target, canonical workspace root, permissions, budgets, and stop policy in one durable approval envelope.

#### Scenario: pre-approval budget edit creates a revision
- **WHEN** the user changes an allowed budget before confirmation
- **THEN** the system validates and appends a new plan revision while keeping execution disabled

#### Scenario: one confirmation starts automatic execution
- **WHEN** the user confirms a valid latest revision
- **THEN** the system appends exactly one idempotent approval fact and makes ready nodes eligible for automatic scheduling

#### Scenario: post-approval mutation is rejected
- **WHEN** a caller attempts to edit the sealed plan in place
- **THEN** the system rejects the mutation and preserves the approved revision

### Requirement: Squad Lifecycle MUST Use Typed Canonical Facts
The system MUST represent run, plan, dispatch, outcome, verification, lease, block, cancellation, and settlement transitions as versioned typed Canonical Facts rather than free-form Control details.

#### Scenario: typed fact round trip
- **WHEN** each Squad fact is serialized, stored, and deserialized
- **THEN** its schema version, run identity, node or attempt identity, and typed payload remain unchanged

#### Scenario: malformed fact is rejected
- **WHEN** a Squad fact omits a required identity or contains a conflicting state payload
- **THEN** canonical validation fails before event insertion

#### Scenario: duplicate transition is idempotent
- **WHEN** the same idempotency identity is appended again with the same payload
- **THEN** the writer reports duplicate success and projection state does not advance twice

### Requirement: Squad Projection MUST Rebuild Deterministically
The system MUST derive `SquadProjectionV1` exclusively from canonical facts and MUST produce identical state for incremental replay and full rebuild.

#### Scenario: checkpoint deletion rebuilds same run
- **WHEN** projection cache and checkpoint are deleted and all canonical events are replayed
- **THEN** run status, plan revision, node states, attempts, budgets, outcomes, and diagnostics match the previous projection

#### Scenario: out-of-order state transition is ignored with diagnostic
- **WHEN** a canonical event stream contains a validly stored but state-incompatible transition from an older schema or repair
- **THEN** projection remains deterministic and emits a scoped diagnostic rather than inventing a transition

#### Scenario: projection is session isolated
- **WHEN** two Shared Sessions have active runs
- **THEN** requesting one session projection never includes the other session run or attempts

### Requirement: Worker Attempts MUST Remain Nested Presentation
The system MUST keep every Squad Worker turn out of the top-level Shared Conversation projection while retaining transcript, artifacts, and outcomes in Squad projection.

#### Scenario: worker completion remains nested
- **WHEN** an Analyze or Verify Worker turn commits canonical assistant content
- **THEN** the top-level Conversation does not render an extra user or assistant bubble and the node detail exposes the linked evidence

#### Scenario: final synthesis becomes top-level answer
- **WHEN** the sealed final Synthesize node succeeds and the run settles successfully
- **THEN** `SquadRunSettled` projects one top-level Shared assistant answer linked to the run while the underlying Synthesize turn remains nested

#### Scenario: hidden native worker session stays internal
- **WHEN** a worker binding receives a native session identity
- **THEN** native sidebar/list projections continue to filter it as a Shared-owned internal session
