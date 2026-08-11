## ADDED Requirements

### Requirement: Curated positive classical Chinese poetry pool

Composer daily banner MUST source its content from a bundled readonly pool containing exactly 30 unique classical Chinese poetry excerpts, forming a 30-local-day rotation. Every entry MUST include the excerpt text, author, and work title, and the visible line MUST preserve those attribution fields without a network dependency.

#### Scenario: Bundled pool meets the content baseline

- **WHEN** the daily poetry pool is inspected at build or test time
- **THEN** it contains exactly 30 entries with unique excerpt text
- **AND** every entry has a non-empty author and work title

#### Scenario: Banner renders attributed classical content

- **WHEN** the daily poetry banner is visible
- **THEN** the Composer displays the selected Chinese excerpt together with its author and work title
- **AND** no remote request is required to resolve the content

### Requirement: Daily deterministic no-repeat rotation

The application MUST choose the banner entry from the user's local calendar date. The result MUST remain stable throughout the same local natural day, every interval of consecutive dates equal to the pool length MUST contain no repetition, and adjacent dates across a rotation boundary MUST NOT repeat.

#### Scenario: Same local day remains stable

- **WHEN** the selector receives two valid times from the same local calendar day
- **THEN** it returns the same poetry entry for both times

#### Scenario: Any pool-sized consecutive interval has no repeats

- **WHEN** the selector is evaluated for consecutive local dates equal to the poetry pool length
- **THEN** every returned excerpt is unique within that interval

#### Scenario: Adjacent rotations do not repeat at the boundary

- **WHEN** one date is the final day of a rotation and the next date is the first day of the following rotation
- **THEN** the two dates return different excerpts

### Requirement: Dismissal applies only to the current day

The application MUST persist a valid local date key when the user dismisses the poetry banner. A dismissal MUST hide the banner for that local date only; a different local date, a missing value, or a malformed persisted value MUST show the banner.

#### Scenario: Dismiss for today

- **WHEN** the user closes the visible poetry banner
- **THEN** the application records the current local date in the Composer-specific client store key
- **AND** hides the banner for the rest of that mounted session and subsequent opens on the same date

#### Scenario: Reappear on the next local date

- **WHEN** the stored dismissal date differs from the current local date
- **THEN** the application shows the poetry banner with that date's selected excerpt

#### Scenario: Malformed persistence fails open

- **WHEN** the stored dismissal value is missing, not a string, or not a valid local date key
- **THEN** the application shows the poetry banner
- **AND** does not let the malformed value drive Composer layout or input behavior

### Requirement: Composer banner interaction and performance parity

The daily poetry banner MUST preserve the existing banner layout and close interaction, use localized accessible copy for the close button, and MUST NOT introduce polling, runtime listeners, or streaming-cadence state updates into the Composer render path.

#### Scenario: Accessible close control

- **WHEN** assistive technology inspects the poetry banner close button
- **THEN** the button exposes the localized `common.close` accessible name

#### Scenario: Existing Composer header surfaces remain compatible

- **WHEN** SDK warnings, message queue items, or attachments are present with or without the poetry banner
- **THEN** those surfaces continue to render under their existing contracts

#### Scenario: Daily content has no live update loop

- **WHEN** the Composer remains mounted during conversation streaming
- **THEN** poetry selection does not subscribe to streaming events or schedule polling updates
