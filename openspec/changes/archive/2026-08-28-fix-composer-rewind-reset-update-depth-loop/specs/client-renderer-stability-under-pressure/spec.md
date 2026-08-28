## ADDED Requirements

### Requirement: Composer rewind reset converges before React state dispatch

Composer rewind UI state MUST converge when the active thread or rewind capability changes. When preview and mode already equal their reset targets, the renderer MUST skip React state dispatch instead of relying only on a functional updater returning the previous value.

#### Scenario: active thread transition resets rewind state

- **WHEN** the active thread identity changes while a rewind preview or non-default rewind mode exists
- **THEN** Composer MUST close the preview and restore `messages-and-files`
- **AND** the transition MUST NOT trigger React `Maximum update depth exceeded` or minified error `#185`

#### Scenario: unavailable rewind capability converges without repeated dispatch

- **WHEN** the active engine/session does not expose an executable rewind callback
- **AND** rewind preview is already closed and mode is already `messages-and-files`
- **THEN** Composer MUST skip both rewind reset state setters
- **AND** repeated parent renders or callback identity changes MUST NOT create a passive-effect update loop

#### Scenario: callback identity is not rewind availability

- **WHEN** the executable rewind callback identity changes but rewind availability remains enabled
- **THEN** Composer MUST preserve the current rewind confirmation interaction
- **AND** capability reset MUST depend on primitive semantic availability rather than callback identity
