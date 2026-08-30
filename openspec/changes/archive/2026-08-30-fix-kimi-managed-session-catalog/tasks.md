## 1. OpenSpec and execution context

- [x] 1.1 完成 proposal / design / delta specs，并通过 strict validation。
- [x] 1.2 创建关联 Trellis task，记录本 change 为唯一 OpenSpec source。

## 2. Kimi provider-home discovery

- [x] 2.1 在 `kimi_history.rs` 抽取统一 root resolver，支持 default root + managed provider homes。
- [x] 2.2 为 summary 增加 optional provider identity，并保持 serde/frontend compatibility。
- [x] 2.3 让 list/load/delete 共用 root + index entry resolution。
- [x] 2.4 为 provider-home enumeration failure 保留可观察的 partial/degraded source semantics。
- [x] 2.5 首轮 sidebar hydration 异步 seed durable Kimi history，覆盖 restart 后无 live signal 的 workspace。

## 3. Catalog and daemon parity

- [x] 3.1 将 Kimi provider metadata 传入 workspace catalog projection。
- [x] 3.2 核对 GUI command、daemon command 与 session management 的同一 resolver 行为。

## 4. Regression tests and verification

- [x] 4.1 Rust tests：default/managed roots、workspace isolation、custom home compatibility。
- [x] 4.2 Rust tests：load/delete 使用发现 root，且不删除 provider home 或 unrelated session。
- [x] 4.3 执行 L3 focused Rust tests、`cargo check --lib`、TypeScript typecheck、runtime contracts。
- [x] 4.4 更新相关 `.trellis/spec` executable contract，并记录 verification evidence。
- [x] 4.5 增加首轮 Kimi seed policy regression test，防止 restart 后仅依赖 in-memory/live signal。
