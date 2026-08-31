# Design: fix-shared-event-log-wal-recovery-probe

## 根因

SQLite WAL mode 的 crash recovery 与 logical integrity check 不是同一件事。`SQLITE_OPEN_READ_ONLY` 可以读取稳定 WAL，但在 unclean shutdown 后可能需要初始化/恢复 WAL sidecar；SQLite 会以 base code `SQLITE_READONLY` 拒绝该内部写入。现有 `probe_integrity()` 把所有 query error 都投影成 `IntegrityCheckFailed`，因此混淆了：

1. logical corruption（应进入 read-only recovery）；
2. probe access mode 不足（应升级 probe capability 后重新判断）。

## 两阶段 probe

```text
READ_ONLY + quick_check(1)
  ├─ ok                 → Ready
  ├─ non-ok status      → ReadOnlyRecovery
  ├─ SQLITE_READONLY    → READ_WRITE|NO_CREATE + query_only=ON + quick_check(1)
  │                         ├─ ok            → Ready
  │                         └─ failure       → ReadOnlyRecovery
  └─ other SQLite error → ReadOnlyRecovery
```

第二阶段 connection 不包含 `SQLITE_OPEN_CREATE`，所以 missing database 仍不可能被 probe 创建；`query_only=ON` 阻止 application-issued INSERT/UPDATE/schema mutation。SQLite 为 WAL recovery 维护 journal/sidecar 的内部 I/O 不改变 committed logical facts，且是恢复 writable store 的必要条件。

## 错误分类

只按 `rusqlite::Error::SqliteFailure(... code == ErrorCode::ReadOnly ...)` 触发 fallback。禁止通过英文 message substring 判断，避免 platform/SQLite version 文案漂移；`BUSY`、`LOCKED`、`CORRUPT`、`NOTADB` 等保持 fail closed。

若 fallback 失败，typed reason 同时保留 read-only probe 与 fallback context，便于诊断但不泄露 payload。

## 验证策略

- L3：persistence startup/recovery boundary。
- focused tests：`shared_event_log_crash`、`shared_event_log_store` recovery scenarios、`recovery.rs` error classification unit tests。
- compile：`cargo check --lib`。
- L4：merge-to-main CI 全量 Rust/JS/Windows gate。
