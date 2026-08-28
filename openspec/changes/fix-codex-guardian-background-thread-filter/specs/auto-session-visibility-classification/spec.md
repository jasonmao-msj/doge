# auto-session-visibility-classification Delta

## ADDED Requirements

### Requirement: External Engine Background Threads SHALL Be Classified by Structural Session Metadata

Codex sessions persisted by the engine itself（非 doge automation 创建，例如 Guardian 审批评审线程）SHALL be classified as background via structural `session_meta` fields, not via prompt or title text matching.

#### Scenario: Guardian review thread is hidden by thread_source

- **WHEN** a Codex rollout `session_meta` declares `thread_source: "guardian_review"`
- **THEN** the local session summary SHALL record `background_kind = "guardian-review"`
- **AND** the workspace thread list SHALL exclude that session from both local and live merge paths

#### Scenario: Unknown subagent helper shapes default to hidden

- **WHEN** a Codex rollout `session_meta` declares `source.subagent` without a `thread_spawn` variant (for example `source.subagent.other`)
- **THEN** the local session summary SHALL record `background_kind = "subagent-helper"`
- **AND** the workspace thread list SHALL exclude that session

#### Scenario: Collab thread_spawn subagents remain visible children

- **WHEN** a Codex rollout `session_meta` declares `source.subagent.thread_spawn` with a parent thread id
- **THEN** the session SHALL NOT be classified as background
- **AND** existing parent-linked display behavior SHALL remain unchanged

#### Scenario: Legacy sessions fall back to prompt-prefix heuristic

- **WHEN** a Codex session lacks structural background signals
- **THEN** the system MAY still apply the existing prompt-prefix heuristic as a fallback
- **AND** prompt text matching SHALL NOT be the primary classification path for sessions that carry structural metadata
