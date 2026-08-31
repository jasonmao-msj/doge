# Verification: fix-shared-event-log-wal-recovery-probe

## 结论

Verification level: **L3 persistence/recovery**。

最高风险触发项是 `SharedEventLog` startup integrity classification：错误实现可能把 healthy WAL 误判为 corruption，或反向放过损坏数据库。影响面限定在 `src-tauri/src/shared_event_log/recovery.rs`；无 schema、payload、IPC、frontend 或用户数据格式变化。

## 已验证

- `shared_event_log::recovery::tests`：3 passed。
  - 只有 typed `ErrorCode::ReadOnly` 命中 fallback。
  - RW fallback 不含 `CREATE`，missing path 不产生文件。
  - fallback 在 integrity SQL 前保持 `query_only=1`，test INSERT 返回 readonly。
- `random_kills_never_corrupt_across_50_rounds`：连续 5 次通过，共 250 crash rounds；每轮断言 `quick_check=ok`、sequence 连续、ack replay idempotent。
- 完整 `shared_event_log_crash`：3 passed，覆盖四个 transaction boundaries 与 50 random kills。
- `damaged_database_enters_read_only_recovery`：passed，真实损坏库仍 fail closed，原文件不覆盖。
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`：passed；只有 repository baseline warnings。
- `openspec validate fix-shared-event-log-wal-recovery-probe --type change --strict --no-interactive`：passed。
- `openspec validate shared-event-storage --type spec --strict --no-interactive`：passed。
- `npm run check:docs`、`git diff --check`：passed。

## 未在本地执行

- L4 全量 Rust/JS/Windows/build/package smoke；由合入后的 final `main` CI 执行。该 gate 未通过前不得触发 v0.1.13 Release。

## CI failure evidence

- Run: `33367953095`
- Job: `test-tauri / 99412574356`
- Failure: `random_kills_never_corrupt_across_50_rounds` 在 restart open 时进入 `ReadOnlyRecovery`，detail=`attempt to write a readonly database`。
