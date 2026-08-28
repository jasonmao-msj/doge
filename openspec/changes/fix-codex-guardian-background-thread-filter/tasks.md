## 1. OpenSpec Artifacts

- [x] 1.1 Author proposal / design / spec delta / tasks for guardian background thread filter. [P0][O: openspec/changes/fix-codex-guardian-background-thread-filter][V: openspec validate]

## 2. Tests first (RED)

- [x] 2.1 local_usage test: session_meta with `thread_source: "guardian_review"` → `background_kind = Some("guardian-review")`. [P0][O: local_usage tests][V: cargo test]
- [x] 2.2 local_usage test: `source.subagent.other`（无 thread_spawn）→ `background_kind = Some("subagent-helper")`；`thread_spawn` 形态不受影响（仍解析 parent_session_id，不标 background）。 [P0][O: local_usage tests][V: cargo test]
- [x] 2.3 thread_listing test: `background_kind.is_some()` 的 local session 被 merge 过滤，且其 id 进入 background id 集合从而过滤同 id live entry。 [P0][O: codex_tests.rs][V: cargo test]

## 3. Implementation (GREEN)

- [x] 3.1 `types.rs`: `LocalUsageSessionSummary` 增加 `background_kind: Option<String>`（serde default + skip None）。 [P0]
- [x] 3.2 `local_usage.rs`: 新增 `classify_codex_background_helper_from_session_value`，parse loop 在 session_meta/turn_context 处填充，构造 summary 时写入。 [P0]
- [x] 3.3 `thread_listing.rs`: `is_codex_background_helper_session` 优先判 `background_kind`，prompt 前缀降级为 fallback。 [P0]
- [x] 3.4 补齐所有 `LocalUsageSessionSummary` struct literal 构造点的新字段。 [P0]

## 4. Gates

- [x] 4.1 定向 cargo test：local_usage + codex thread_listing 相关测试（Risk-Based L1）。 [P0]
- [x] 4.2 `cargo check` / clippy 无新增告警。 [P1]
- [ ] 4.3 人工验收：dev 环境下 doge workspace 会话列表不再出现 guardian 会话。 [P0][V: manual]
