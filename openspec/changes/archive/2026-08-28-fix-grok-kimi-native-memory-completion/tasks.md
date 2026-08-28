## 1. Spec

- [x] 1.1 proposal / design / delta specs
- [x] 1.2 `openspec validate fix-grok-kimi-native-memory-completion --strict --no-interactive`

## 2. Backend

- [x] 2.1 `gemini_agent_completion_item_id` helper（commands + daemon）
- [x] 2.2 Gemini / Kimi / Grok `TurnCompleted`：移除 `!saw_text_delta`，用 text-lane id emit completed
- [x] 2.3 daemon_state 三处同步

## 3. Tests

- [x] 3.1 Rust：delta 后 completion id 与 text lane 一致
- [x] 3.2 Rust：Tool 清空 active_text 后仍可重建 last text id
- [x] 3.3 保留 FE「Grok/Kimi turn/completed 不前端合成」测试

## 4. Validate

- [x] 4.1 `cargo test --lib engine::commands::commands_tests::gemini_agent_completion` 通过
- [x] 4.2 相关 vitest / openspec validate 通过（typecheck 见交付门禁）
