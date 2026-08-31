## 1. OpenSpec / Trellis

- [x] 1.1 建立 proposal、design、spec delta 与 Trellis task，记录 CI failure 事实。 [P0]

## 2. Implementation

- [x] 2.1 将 integrity probe 拆成 reusable `quick_check` 与 typed SQLite error classification。 [P0]
- [x] 2.2 read-only probe 仅在 `SQLITE_READONLY` 时 fallback 到 `READ_WRITE|NO_CREATE + query_only=ON`。 [P0]
- [x] 2.3 保留其他 failure 的 fail-closed `ReadOnlyRecovery` 与诊断 context。 [P0]

## 3. Verification

- [x] 3.1 增加 `SQLITE_READONLY` classification、no-create 与 query-only regression。 [P0]
- [x] 3.2 连续运行 focused crash suite，验证 5 × 50 轮 random kill，并运行完整 transaction-boundary suite。 [P0]
- [x] 3.3 运行 damaged database recovery tests、`cargo check --lib`、strict OpenSpec validation。 [P0]
- [x] 3.4 将 final `main` L4 CI 明确保留为外部 Release gate，不由本地 L3 或 OpenSpec archive 替代。 [P0]
