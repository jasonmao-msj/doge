## ADDED Requirements

### Requirement: Sidebar SHALL provide an on-demand account shortcut

The primary Sidebar MUST expose a compact account shortcut in its bottom navigation area. Activating it MUST reveal a compact account/subscription summary and provide a direct handoff to Settings account; it MUST NOT add another primary page, permanent explanatory text, or background summary polling.

#### Scenario: user opens account shortcut

- **WHEN** a user activates the Sidebar account shortcut
- **THEN** Doge MUST request the lightweight subscription summary only after that interaction
- **AND** the compact surface MUST show safe identity and available subscription/remaining quota facts
- **AND** activating the summary MUST open the existing Settings account page

#### Scenario: summary cannot be loaded

- **WHEN** the one-shot summary request fails or is unavailable
- **THEN** the shortcut MUST remain usable to open Settings account
- **AND** it MUST display the established non-sensitive unavailable state without retry polling
