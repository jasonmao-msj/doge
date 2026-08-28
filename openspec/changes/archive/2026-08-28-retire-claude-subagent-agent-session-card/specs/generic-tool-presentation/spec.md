## ADDED Requirements

### Requirement: SubAgent primary surface excludes legacy agent-task card

When a tool item is classified as subAgent for canvas rendering, the conversation canvas MUST treat the persona / squad (S10) surface as the only primary completion chrome for that SubAgent. A sibling SubAgent-style `<task-notification>` message MUST NOT introduce a second completion card (legacy `message-agent-task-card`).

#### Scenario: Agent tool completion has single completion chrome

- **WHEN** a Claude Agent/Task tool item is rendered via subagentGroup and a SubAgent-style task-notification also appears in the same turn
- **THEN** the user-visible completion chrome MUST be the S10 card (or its process-phase collapsed host)
- **AND** the legacy Agent session card MUST NOT appear for that notification
