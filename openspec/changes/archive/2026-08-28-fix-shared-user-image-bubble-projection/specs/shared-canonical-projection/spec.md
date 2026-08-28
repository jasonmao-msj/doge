## ADDED Requirements

### Requirement: turnRequested MUST project user image locators onto the user message item

When `CanonicalFact::TurnRequested` carries `input.image_refs`, `SharedProjector` MUST include those locators on the projected user `message` content as an `images` array of non-empty locator strings. Projection MUST NOT invent `generatedImage` items for user-attached input images.

#### Scenario: turnRequested with image_refs projects images array

- **WHEN** a turnRequested fact has `input.text = "hello"` and one `image_refs` entry with `locator = "/tmp/photo.png"`
- **THEN** the projector produces a user message projection item with `role=user`, `text` containing the user text
- **AND** `content.images` is a non-empty array that includes `"/tmp/photo.png"`
- **AND** no `generatedImage` item is created solely from those user input image_refs

#### Scenario: turnRequested without image_refs omits images field or empties it

- **WHEN** a turnRequested fact has text only and `image_refs` is absent or empty
- **THEN** the projected user message does not require an images list
- **AND** behavior remains backward compatible with existing text-only turns
