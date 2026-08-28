## ADDED Requirements

### Requirement: Live Settlement And History Upsert MUST Not Duplicate Equivalent Assistant Rows

When live completed settlement has already stored an assistant final body, a later history hydrate or `upsertItem` of an equivalent assistant snapshot MUST NOT create a second visible assistant row on Native or Shared threads. History MAY canonicalize id, timestamps, or metadata onto the existing row.

#### Scenario: shared live final then history upsert same body

- **WHEN** a Shared thread has a live `completeAgentMessage` assistant final
- **AND** history projection upserts an equivalent assistant message with a different id
- **THEN** visible assistant cardinality for that semantic response MUST remain one
- **AND** history reconcile MUST NOT be required as the only repair

#### Scenario: native live final then history upsert same body

- **WHEN** a Native Claude (or other non-Codex) thread has a live final assistant message
- **AND** an equivalent history snapshot arrives with another id
- **THEN** conversation state MUST keep a single assistant message for that response
