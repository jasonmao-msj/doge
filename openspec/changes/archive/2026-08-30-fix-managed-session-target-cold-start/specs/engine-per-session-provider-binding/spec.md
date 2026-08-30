# engine-per-session-provider-binding Delta

## ADDED Requirements

### Requirement: Per-Session Execution Target MUST Survive Cold Start

系统 MUST 将已确认的 session execution target（`modelCatalogEntryId`、runtime `model` 与
`reasoningEffort`）按 canonical session identity 持久化，并在 session catalog 中投影，供
renderer 在 cold start 恢复；旧 metadata 缺少该字段时 MUST 保持可读取。

#### Scenario: model selection is persisted before the next turn

- **WHEN** 用户在已有 native session 中选择模型或 reasoning effort，随后在未发送下一条消息前退出应用
- **THEN** renderer MUST 通过 `record_session_execution_target` 立即写入该 session 的 durable target
- **AND** write failure MUST 保留可观察 diagnostic，不能静默覆盖为 global/default model
- **AND** Shared V2 的 atomic target 与跨 engine picker MUST NOT 被误写为 native session target

#### Scenario: selected Codex model is restored after restart

- **WHEN** 用户发送消息时选择 `k3-256k`，并随后重启应用
- **THEN** backend MUST 从 durable session metadata 恢复该 session 的
  `modelCatalogEntryId`、runtime `model` 与 `reasoningEffort`
- **AND** renderer MUST 优先使用 durable target，而不是 stale `selectedModelByThread.*`
  cache 或 engine default

#### Scenario: durable target and provider continuation are projected together

- **WHEN** session 同时存在 provider binding、provider continuation metadata 与 durable
  execution target
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
