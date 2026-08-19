## 1. Development resource contract

- [x] 1.1 在 `tauri-dev-resources.mjs` 同步完整 bundled engine resources 到 debug `resource_dir`，先完成 staging 再在应用启动前替换。
- [x] 1.2 扩展 Node test，覆盖完整同步、stale destination replacement 和缺失 source fail-fast。

## 2. Recoverable account feedback

- [x] 2.1 在 AccountAppGate `preparing` failure surface 中呈现已映射的 safe error message。
- [x] 2.2 增加 focused UI test，断言 toolchain failure 不再只有 generic title 且 retry 可再次调用 resolver。

## 3. Verified account engine activation

- [x] 3.1 为已验证的 account-managed engine 增加不依赖 global status cache 的 Native activation path。
- [x] 3.2 覆盖 managed activation 与普通 unavailable engine activation 的回归测试。

## 4. Verification

- [x] 4.1 运行 Node resource tests、focused Vitest、typecheck、lint 与 OpenSpec strict validation。
- [x] 4.2 运行 focused Rust manager test 与 `cargo fmt --check`。
- [x] 4.3 验证 debug resource staging 为 independent real tree，manifest 与 Codex/Claude binaries 完整且 `--version` 成功；现有 Tauri dev instance 需重启后人工确认 AppShell。
