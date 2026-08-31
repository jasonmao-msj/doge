# Fix Managed Kimi Session Catalog

## Linked OpenSpec Change

`fix-kimi-managed-session-catalog`

## Goal

修复应用重启后 managed Kimi provider home 中的历史会话无法被 workspace session catalog 发现的问题。list/load/delete 必须共享 provider-aware root resolution，并保持 GUI/daemon parity。

## Scope

- `src-tauri/src/engine/kimi_history.rs`
- Kimi catalog projection 与 command callers
- Kimi summary/frontend provider metadata mapping
- Rust focused regression tests
- OpenSpec/code-spec sync

## Verification

按 L3 Cross-layer / High-risk 执行：OpenSpec strict validation、affected Rust tests、`cargo check --lib`、`npm run typecheck`、`npm run check:runtime-contracts`。不默认执行 L4 全量 test/lint/build。
