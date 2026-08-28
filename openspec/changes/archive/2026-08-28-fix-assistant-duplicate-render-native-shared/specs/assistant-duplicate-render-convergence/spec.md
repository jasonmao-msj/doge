## ADDED Requirements

### Requirement: Assistant Text Merge MUST Collapse Early-Body Echo After Longer Snapshot

The shared assistant text merge path (`mergeAgentMessageText` / `mergeCompletedAgentText` and their normalizers) MUST collapse payloads where a longer snapshot is followed by a replay of an earlier body prefix or early paragraph block, not only exact `A+A` or `prefix+full` forms. This MUST apply to Native and Shared sessions for every engine that uses the shared reducer merge helpers.

#### Scenario: longer draft then early-body echo collapses to one readable copy

- **WHEN** the existing assistant text is a longer draft `A2` that already contains early body `A`
- **AND** an incoming stream/snapshot/completed payload equals `A2` plus a separator plus a replay of `A` (or an equivalent early-body block)
- **THEN** the merge result MUST keep a single readable copy of the full draft
- **AND** the early body MUST NOT appear twice in the stored assistant `text`

#### Scenario: classic prefix-plus-full and exact double still collapse

- **WHEN** completed payload replays streamed prefix plus full final, or exact `A` concatenated with `A`
- **THEN** settlement MUST still converge to one readable assistant body
- **AND** existing regression coverage for those forms MUST remain green

#### Scenario: non-echo genuine growth is preserved

- **WHEN** the incoming payload is a strict growing snapshot `existing + novelSuffix` without replaying the leading body
- **THEN** merge MUST keep the novel suffix
- **AND** MUST NOT truncate legitimate new paragraphs

### Requirement: Equivalent Assistant Observations MUST Converge Across Item Ids On Native And Shared

Conversation state MUST converge equivalent assistant observations that arrive under different item ids within the same user turn into a single assistant message, for **both Native and Shared** threads. This includes Claude Native, Shared sessions bound to Claude or other engines, and Codex. Tool-separated or non-equivalent assistant segments MUST remain separate.

#### Scenario: shared claude different completion ids converge

- **WHEN** `threadKind` is `shared` and `engineSource` is `claude` (or the thread is a Shared owner projection)
- **AND** two `completeAgentMessage` events deliver equivalent assistant text under different item ids without an intervening user or tool item
- **THEN** conversation state MUST contain exactly one assistant message for that semantic response
- **AND** Shared MUST NOT disable equivalent-id convergence solely because `threadKind === "shared"`

#### Scenario: native claude different completion ids converge

- **WHEN** a Native Claude thread receives equivalent assistant completion under a second item id
- **AND** no user message or tool item separates the two observations
- **THEN** the second observation MUST update or merge into the existing assistant message
- **AND** the canvas MUST NOT show two adjacent identical assistant bubbles

#### Scenario: live complete then history upsert alias converges

- **WHEN** live settlement has already stored a final assistant message
- **AND** history hydrate or reconcile upserts an equivalent assistant snapshot with a different id
- **THEN** state MUST keep one assistant message
- **AND** history MAY refresh id/metadata on the canonical row without appending a second bubble

#### Scenario: tool-separated non-equivalent segments stay separate

- **WHEN** assistant text A is followed by a tool item and then assistant text B with different semantic content
- **THEN** both assistant messages MUST remain
- **AND** equivalent-id convergence MUST NOT merge B into A across the tool boundary

#### Scenario: native codex idempotency does not regress

- **WHEN** a Native Codex thread receives the previously covered alias/fallback/duplicate shapes
- **THEN** convergence MUST still yield a single assistant message per semantic response
- **AND** existing Codex duplicate regression tests MUST remain green
