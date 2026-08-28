## ADDED Requirements

### Requirement: Shared user image attachments MUST project to a single canvas user bubble

Shared Session V2 SHALL persist user image attachment paths on `conversation.turnRequested` and project them onto the same user `message` ConversationItem that carries the turn text, so the unified Messages canvas renders **exactly one** user bubble with both text and images when the user sent both.

#### Scenario: text-plus-image send shows one bubble with image

- **WHEN** a Shared session (any supported engine) sends a turn with non-empty user text and one or more local image paths
- **THEN** `TurnRequested.input.image_refs` is non-empty with locators matching those paths
- **AND** the shared projector emits one user `message` item whose content includes both the text and an `images` locator list
- **AND** the FE shared projection dataSource maps that item to a ConversationItem with `role=user`, the same text, and non-empty `images`
- **AND** the canvas MUST NOT show a second user bubble for the same turn that duplicates the text without images solely due to optimistic/projection dual retention

#### Scenario: model still receives images via dispatch

- **WHEN** the same turn is dispatched to the engine runtime
- **THEN** the existing dispatch `images` parameter continues to be forwarded unchanged
- **AND** recognition of image content by the model MUST NOT regress because of projection changes

### Requirement: Optimistic and authoritative user messages MUST converge with images

When an optimistic user message and a projected/real user message represent the same user turn text, the thread merge layer MUST converge them to a single item and MUST prefer non-empty `images` so that temporary authoritative messages missing image_refs do not erase already-rendered attachments or leave two bubbles.

#### Scenario: optimistic with images replaces empty-image projection without dual bubble

- **WHEN** local items contain one optimistic user message with text T and images I
- **AND** incoming items contain one real user message with text T and empty images
- **THEN** the merged list contains exactly one user message for that turn
- **AND** the surviving item retains non-empty images derived from the optimistic side (or from a later projection that includes images)

#### Scenario: projection with images replaces optimistic cleanly

- **WHEN** local items contain one optimistic user message with text T and images I
- **AND** incoming items contain one real user message with text T and images I (same identity)
- **THEN** the optimistic id is dropped and the real message is the sole survivor

### Requirement: Shared history reload MUST retain user attachment images

When Shared history is loaded via dual-read (legacy snapshot + canonical projection) or projection-only rebuild, user message bubbles MUST retain attachment images when either side carries non-empty `images` for the same user turn text, and projection cache MUST rebuild after the user-image projection contract changes.

#### Scenario: history merge keeps images from the richer side

- **WHEN** legacy user message has text T and images I
- **AND** projected user message has text T and empty images
- **THEN** the merged history list contains exactly one user message for that turn
- **AND** the surviving message retains images I

#### Scenario: projection-only history after cache version bump

- **WHEN** `CANVAS_PROJECTION_VERSION` increases after the user-image projection contract lands
- **AND** a turnRequested fact includes image_refs
- **THEN** the next history load rebuilds projection and emits user message content with images locators
