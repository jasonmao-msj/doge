## MODIFIED Requirements

### Requirement: Agent-task and command contracts use their real owner

Agent-task notification parsing MUST be owned by `engine-task-output/contracts`, and command
message tag parsing MUST be owned by root neutral utilities.

Messages consumers MUST parse via that contract. For **SubAgent-style** notifications (as defined by the claude-subagent-canvas-surface capability), messages MUST NOT render the legacy agent-task card; presentation ownership for those completions is the subagent-ui surface. Non-SubAgent-style notifications MAY still use the legacy card.

#### Scenario: messages renders agent-task notification

- **WHEN** messages receives an engine-task notification payload
- **THEN** it MUST consume the engine-task-output contract without reverse importing messages

#### Scenario: SubAgent-style notification does not use legacy card

- **WHEN** messages receives a SubAgent-style engine-task notification payload
- **THEN** it MUST still parse via the engine-task-output contract
- **AND** MUST NOT present the legacy `.message-agent-task-card` chrome for that payload
