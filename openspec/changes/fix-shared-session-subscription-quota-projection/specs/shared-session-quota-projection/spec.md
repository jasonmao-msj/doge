# shared-session-quota-projection Specification

## ADDED Requirements

### Requirement: Shared quota MUST use the authoritative target-scoped subscription source

Shared Session 的 quota projection MUST use the current `selectedNextTarget` / active target
identity（`engine`、`providerProfileId`、managed account context when applicable）读取
authoritative Token Matrix subscription quota。它 MUST NOT silently replace a managed target
with local provider quota、历史 provider quota 或 global active engine quota。

#### Scenario: managed Codex target has an active Token Matrix subscription

- **WHEN** a signed-in user opens a Shared Session whose selected target is managed Codex
- **AND** the Token Matrix authority returns a valid subscription quota snapshot
- **THEN** the quota panel MUST display the Token Matrix provider, Codex engine, plan identity,
  used/total window values and reset time
- **AND** the panel MUST NOT display `empty` as the provider

#### Scenario: one Shared target changes engine

- **WHEN** a Shared Session sends one turn through Codex and the next turn through Claude
- **THEN** each quota entry MUST retain the engine/provider attribution of its target
- **AND** Codex quota MUST NOT be displayed as Claude quota or vice versa

### Requirement: Quota loading, empty, unavailable and not-subscribed states MUST remain distinct

The Shared quota UI MUST distinguish an in-flight read, an authoritative empty result, an
authoritative not-subscribed result, and a temporary authority/network failure. A missing or
delayed projection MUST NOT be rendered as “已识别套餐供应商，但还没有额度窗口数据” after a
successful provider identification unless the authority has actually completed with an empty
quota result.

#### Scenario: quota read is still pending

- **WHEN** the Shared quota request has not completed
- **THEN** the panel MUST show a loading state
- **AND** it MUST NOT show an empty provider or empty quota result

#### Scenario: authority reports not subscribed

- **WHEN** the authority completes a target-scoped read with an explicit not-subscribed reason
- **THEN** the panel MUST show a not-subscribed state for that engine
- **AND** it MUST NOT substitute local or historical quota data

#### Scenario: authority is temporarily unavailable

- **WHEN** the target-scoped authority read fails with a retryable network or service error
- **THEN** the panel MUST show a retryable unavailable state
- **AND** successful quota entries for other Shared targets MUST remain visible

### Requirement: Shared quota entries MUST be isolated and credential-free

When multiple Shared targets are queried, each entry MUST have an independent loading/error/
snapshot lifecycle keyed by target identity. Renderer payloads MUST contain only credential-free
quota data; API keys, refresh tokens and vault contents MUST NOT enter component props, logs or
generic DTOs.

#### Scenario: one provider fails while another succeeds

- **WHEN** a Shared Session has two target-scoped quota reads and only one read succeeds
- **THEN** the successful target MUST display its quota snapshot
- **AND** the failed target MUST display its own error state without clearing the successful entry

#### Scenario: raw secret appears at a boundary

- **WHEN** a quota adapter, IPC validator or renderer projection receives a raw API secret
- **THEN** the boundary MUST reject or redact the secret before it reaches the UI
- **AND** the secret MUST NOT be written to logs or persisted quota snapshots
