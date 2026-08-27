## ADDED Requirements

### Requirement: Existing thread engine remains authoritative after navigation

When a user opens an existing conversation, the UI MUST derive the Composer
engine from the thread's authoritative `engineSource`. A stale
`selectedEngine` snapshot or global `activeEngine` MUST NOT replace it. Home
creation keeps using the global selected engine because it has no thread owner.

#### Scenario: Codex thread is restored while another engine is globally selected

- **WHEN** the active thread has `engineSource="codex"` and the global engine
  or `selectedEngine` is another supported engine
- **THEN** the Composer displays Codex and a send remains bound to the Codex
  thread instead of creating a thread for the global engine

#### Scenario: Any supported engine thread is restored with a stale snapshot

- **WHEN** an active Claude, Codex, Gemini, Grok, Kimi, or OpenCode thread has
  an `engineSource` different from its `selectedEngine`
- **THEN** the Composer displays that thread's `engineSource`

#### Scenario: Home has no thread owner

- **WHEN** the user opens Home to create a conversation
- **THEN** the Composer uses the global selected engine as the initial target
