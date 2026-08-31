## 1. OpenSpec Artifacts

- [x] 1.1 Author proposal / design / spec delta / tasks. [P0][O: openspec/changes/fix-codex-guardian-session-catalog-visibility][V: openspec validate]

## 2. Tests first (RED)

- [x] 2.1 catalog projection test: `background_kind.is_some()` 的 codex summary 不产出 catalog entry，普通 summary 正常产出。 [P0][O: session_management tests][V: cargo test]
- [x] 2.2 daemon test: `build_codex_daemon_local_thread_response` 输入含 background session 时响应 data 不含其 id。 [P0][O: daemon_state_tests][V: cargo test --bin doge_daemon]

## 3. Implementation (GREEN)

- [x] 3.1 `local_usage.rs`: 接收从 `thread_listing.rs` 移入的分类 helpers（pub(crate)）。 [P0]
- [x] 3.2 `thread_listing.rs`: 删除本地定义，改为 `use crate::local_usage::...`。 [P0]
- [x] 3.3 `session_management_catalog_projection.rs`: codex entries 映射前过滤 background session。 [P0]
- [x] 3.4 `daemon_state.rs` / `codex_local_threads.rs`: local fallback 过滤 + live 透传过滤（id 集合 + 文本兜底，scan 失败降级）。 [P0]

## 4. Gates

- [x] 4.1 定向 cargo test：catalog projection + daemon + 既有 PR #38 回归（Risk-Based L3，跨层 contract）。 [P0]
- [x] 4.2 cargo check（lib + bin）/ rustfmt 变更文件 / openspec validate --strict。 [P0]
- [ ] 4.3 人工验收：v0.1.12 dev 环境侧边栏不再出现 guardian 会话（含重启后 catalog hydration）。 [P0][V: manual]
