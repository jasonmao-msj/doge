# shared-execution-target Delta

## ADDED Requirements

### Requirement: Shared Cold Start MUST Not Replace Durable Target With Product Default

系统 MUST 在 Shared existing-session cold start 中等待 durable target hydration，并以
`shared_sessions_v2.selected_target_json` 为第一读取权威；legacy `meta.json` 仅在 V2 row
缺失时兼容读取。读取与 mount 阶段 MUST NOT 把 Product/global default 当作用户选择写回。

#### Scenario: empty renderer target waits for durable hydration

- **WHEN** Shared Composer 已 mount 且 Product catalog ready，但 `selectedNextTarget` 仍为 null
- **THEN** Composer MUST NOT 调用 `set_shared_session_selected_engine`
- **AND** MUST NOT 将 catalog 首个/default model 发布为该 existing session 的 target
- **AND** history loader 返回 durable target 后 MUST 按原值 hydrate Composer

#### Scenario: V2 target wins over stale legacy metadata

- **WHEN** legacy `meta.json` 记录 `Codex / gpt-5.6-sol`，而同一 session 的 Shared V2 row
  记录 `Kimi / k3-256k`
- **THEN** `load_shared_session` MUST 返回完整 `Kimi / k3-256k` target
- **AND** selected engine/sidebar projection MUST 与 V2 target engine 一致
- **AND** read path MUST NOT 改写 legacy metadata 或 V2 row

#### Scenario: complete legacy identity may be repaired explicitly

- **WHEN** 已 hydrate 的完整 Shared target 使用旧 catalog alias，且 Product catalog 能确定
  唯一 canonical identity
- **THEN** existing automatic repair MAY 持久化 canonical target
- **AND** null/partial target MUST NOT 进入该 repair mutation
