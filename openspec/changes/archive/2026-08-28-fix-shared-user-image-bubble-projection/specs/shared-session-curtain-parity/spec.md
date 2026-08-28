## ADDED Requirements

### Requirement: Shared user attachment display parity with Native user bubbles

Shared Session canvas MUST display user-attached images on the user message bubble using the same MessageRow / MessageImageGrid path as Native sessions when projection or optimistic items supply `images`. Shared MUST NOT rely on a separate attachment-only bubble that duplicates the user text.

#### Scenario: shared user message with images uses standard image grid

- **WHEN** a Shared thread ConversationItem has `kind=message`, `role=user`, non-empty `text`, and non-empty `images`
- **THEN** the unified Messages timeline renders a single user row with MessageImageGrid (or equivalent) plus text
- **AND** no Shared-only dual text bubble is introduced for the same item identity

#### Scenario: text-only shared user message unchanged

- **WHEN** a Shared user message has text and no images
- **THEN** rendering remains a single text user bubble as before this change
