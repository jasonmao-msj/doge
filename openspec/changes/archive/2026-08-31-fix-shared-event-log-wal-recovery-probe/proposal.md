# Proposal: fix-shared-event-log-wal-recovery-probe

## Why

`SharedEventLog` 在 existing non-empty SQLite database 启动时，先用 `SQLITE_OPEN_READ_ONLY` 执行 `PRAGMA quick_check(1)`。当上一个进程在 WAL transaction 后被强杀，SQLite 可能需要 writable handle 完成 WAL recovery；纯 read-only probe 此时会返回 `SQLITE_READONLY`（`attempt to write a readonly database`）。现有实现把这个 access-mode failure 当成 integrity corruption，错误进入 `ReadOnlyRecovery`。

GitHub Actions `test-tauri` 的 `random_kills_never_corrupt_across_50_rounds` 已捕获该问题：数据本身没有损坏，但 restart probe 误报 recovery，阻塞 v0.1.13 Release gate。真实用户在系统崩溃、强制退出或掉电后也可能遇到同类误判。

## What Changes

- 保留 `READ_ONLY + quick_check(1)` primary probe。
- 只对 typed SQLite `READONLY` 使用 `READ_WRITE|NO_CREATE + query_only=ON` fallback。
- 维持其他 SQLite failure 的 fail-closed recovery，并补齐 crash/no-create/query-only regression。

## 目标

- 保留 read-only `quick_check` 作为首选、最小权限 probe。
- 只有 read-only probe 明确返回 `SQLITE_READONLY` 时，使用 `READ_WRITE`、`NO CREATE` connection，并立即开启 `PRAGMA query_only = ON` 后重跑 `quick_check(1)`，允许 SQLite 完成必要的 WAL recovery，但禁止 application SQL mutation。
- 真实 corruption、无法打开、busy 或其他 SQLite failure 继续 fail closed，进入 typed `ReadOnlyRecovery`，绝不删除、重命名或创建空库覆盖原文件。

## 非目标

- 不弱化损坏数据库的 recovery contract。
- 不改变 schema migration、writer transaction、WAL 配置或用户数据格式。
- 不以简单 retry CI 的方式掩盖 flaky failure。

## 验收

- focused crash suite 连续执行不再把 healthy hot WAL 误判为 corruption。
- damaged database 仍进入 `ReadOnlyRecovery`，原文件不被覆盖。
- `cargo check --lib` 与 shared-event-storage focused tests 通过；最终 `main` L4 CI 全绿后才允许 Release。
