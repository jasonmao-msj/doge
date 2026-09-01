## MODIFIED Requirements

### Requirement: New-Session Defaults SHALL Prefer A Prepared Managed Account Provider

For a signed-in account with a successfully prepared and active supported engine entitlement, a newly created Codex or Claude session with no explicit provider selection MUST bind `doge-token-matrix` as its managed `providerProfileId`. The frontend MUST resolve and freeze the selected engine's complete `modelCatalogEntryId + runtime model + effort` from that provider-scoped Product target catalog before the first Turn. This default applies only to new-session creation; existing bindings, explicit local/manual choices, Local Mode, signed-out state, inactive entitlement, and failed preparation MUST retain their previous behavior.

#### Scenario: eligible account creates a new managed session

- **WHEN** account onboarding has successfully prepared the active Codex entitlement and the user creates a new Codex session without choosing a provider
- **THEN** the creation target MUST carry `providerProfileId = "doge-token-matrix"`
- **AND** its model/catalog entry MUST be resolved from that provider's catalog
- **AND** it MUST NOT send a disk/local model id to the managed provider

#### Scenario: eligible account creates and immediately sends to managed Codex

- **WHEN** account onboarding has prepared Codex and a new managed Native session sends before per-thread cache/durable hydration settles
- **THEN** the first Turn MUST use the same complete Product target displayed by Composer
- **AND** the dispatch MUST carry exact `modelCatalogEntryId`, runtime `model` and `effort`
- **AND** it MUST NOT use managed `config.toml`、global selection or disk catalog as a parallel target authority

#### Scenario: managed Product target is unresolved

- **WHEN** the Product entitlement snapshot or canonical target cannot resolve a complete managed model identity
- **THEN** Composer MUST keep editing available but disable submit
- **AND** the system MUST produce no Session/Binding/Turn fallback side effect

#### Scenario: explicit local choice remains authoritative

- **WHEN** the user explicitly selects a local/disk/manual provider for a new eligible engine session
- **THEN** the selected provider MUST remain the creation target
- **AND** Doge MUST NOT inject `doge-token-matrix`

#### Scenario: managed catalog cannot be resolved

- **WHEN** an eligible managed default has no usable provider-scoped catalog
- **THEN** creation MUST follow the existing unavailable/diagnostic behavior
- **AND** it MUST NOT silently retry through the local/disk provider

### Requirement: Per-Session Execution Target MUST Survive Cold Start

系统 MUST 将已确认的 session execution target（`modelCatalogEntryId`、runtime `model` 与 `reasoningEffort`）按 canonical session identity 持久化，并在 session catalog 中投影，供 renderer 在 cold start 恢复；旧 metadata 缺少该字段时 MUST 保持可读取。对于 Product managed Native session，首轮 send snapshot MUST 与 UI target 同步建立，不得等首轮失败后再由 effect/cache 修复。

#### Scenario: model selection is persisted before the next turn

- **WHEN** 用户在已有 native session 中选择模型或 reasoning effort，随后在未发送下一条消息前退出应用
- **THEN** renderer MUST 通过 `record_session_execution_target` 立即写入该 session 的 durable target
- **AND** write failure MUST 保留可观察 diagnostic，不能静默覆盖为 global/default model
- **AND** Shared V2 的 atomic target 与跨 engine picker MUST NOT 被误写为 native session target

#### Scenario: first managed turn precedes async persistence

- **WHEN** managed Native thread 已创建，但 durable target write 或 Composer cache hydration 尚未完成
- **THEN** first send MUST 使用 send-boundary frozen target
- **AND**后续 persistence MUST mirror that same target
- **AND** UI MAY NOT display a different model after Runtime already accepted another model

#### Scenario: selected Codex model is restored after restart

- **WHEN** 用户发送消息时选择 `k3-256k`，并随后重启应用
- **THEN** backend MUST 从 durable session metadata 恢复该 session 的 `modelCatalogEntryId`、runtime `model` 与 `reasoningEffort`
- **AND** renderer MUST 优先使用 durable target，而不是 stale `selectedModelByThread.*` cache 或 engine default

#### Scenario: durable target and provider continuation are projected together

- **WHEN** session 同时存在 provider binding、provider continuation metadata 与 durable execution target
- **THEN** catalog projection MUST 保留 continuation lineage fields 与完整 execution target
- **AND** continuation projection 的组装顺序 MUST NOT 清空 durable target fields

#### Scenario: old metadata remains readable

- **WHEN** backend 读取没有 `execution_target_by_session_key` 的 legacy metadata JSON
- **THEN** deserialization MUST 成功
- **AND** session MUST 继续使用既有 cache/default fallback，不能因为缺少 target 字段而失败

#### Scenario: deleted session removes its durable target

- **WHEN** 用户删除一个已记录 execution target 的 session
- **THEN** backend MUST 同时清理 canonical target metadata 与兼容 alias
- **AND** 后续 catalog hydration MUST NOT 恢复被删除的 model selection
