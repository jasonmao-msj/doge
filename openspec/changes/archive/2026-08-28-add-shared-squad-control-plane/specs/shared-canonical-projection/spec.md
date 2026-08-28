## ADDED Requirements

### Requirement: Canonical Projection MUST Separate Squad Worker Presentation From Top-Level Conversation
The canonical projection layer MUST use durable owner metadata to keep every Squad Worker turn, including final Synthesize, out of top-level Conversation items and MUST expose Worker evidence only through `SquadProjectionV1`.

#### Scenario: linked attempt is excluded from timeline
- **WHEN** a requested, committed, or usage fact carries a durable Squad Worker binding
- **THEN** Shared Conversation projection omits its top-level rows without deleting its canonical evidence

#### Scenario: successful settlement publishes final answer
- **WHEN** `SquadRunSettled(status=succeeded)` carries the validated final summary
- **THEN** Shared Conversation projection publishes exactly one run-linked assistant answer without exposing the Synthesize Worker turn

#### Scenario: ordinary turn remains unchanged
- **WHEN** a committed Shared turn has no Squad attempt linkage
- **THEN** existing canonical-to-ConversationItem behavior remains unchanged

#### Scenario: rebuild preserves nesting
- **WHEN** projection is rebuilt after restart
- **THEN** the same attempts remain nested and no worker transcript flashes as a top-level conversation row
