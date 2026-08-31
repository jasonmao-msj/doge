# 修复 Shared Event Log 崩溃恢复探测

OpenSpec change: `fix-shared-event-log-wal-recovery-probe`

## Outcome

修复 healthy WAL database 在 unclean shutdown 后被 read-only `quick_check` 误判为 corruption 的问题，恢复 release CI，同时不弱化真实损坏数据的 fail-closed 保护。

## Scope

- `src-tauri/src/shared_event_log/recovery.rs`
- `src-tauri/tests/shared_event_log_crash.rs` 与 focused storage regression
- `openspec/changes/fix-shared-event-log-wal-recovery-probe/**`

## Verification

Risk level: L3 persistence/recovery。

- focused random-kill crash suite（至少 50 轮）
- damaged database recovery test
- `cargo check --lib`
- strict OpenSpec validation
- final `main` L4 CI
