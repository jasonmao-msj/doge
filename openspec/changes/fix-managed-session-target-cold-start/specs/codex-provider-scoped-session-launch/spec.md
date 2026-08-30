# codex-provider-scoped-session-launch Delta

## ADDED Requirements

### Requirement: Managed Codex Restore MUST Rehydrate And Verify Its Toolchain

应用重启后，managed Codex provider 的 engine restore MUST 从现有 bundled/external toolchain
重新 resolve 并 verify；通过验证后 MUST 使用 `account_engine_v1_activate`，不能把 managed
runtime 当作普通 disk engine 走 generic `switch_engine`。

#### Scenario: managed Codex binary cache is cold after restart

- **WHEN** persisted active engine 是 managed Codex，且当前 Rust process 没有 binary cache
- **THEN** restore MUST resolve 当前 bundled/external selected binary 并完成 verification
- **AND** verified binary MUST 被重新放入 launch cache 后再激活

#### Scenario: managed restore activation succeeds

- **WHEN** managed Codex toolchain resolve 与 verification 成功
- **THEN** restore MUST call `account_engine_v1_activate("codex")`
- **AND** MUST NOT call generic `switch_engine("codex")` as the managed activation boundary

#### Scenario: managed restore verification fails

- **WHEN** managed binary missing、resolve 失败或 verification 失败
- **THEN** restore MUST fail closed with a diagnostic/recovery state
- **AND** MUST NOT silently replace the managed target with disk/global Codex configuration
