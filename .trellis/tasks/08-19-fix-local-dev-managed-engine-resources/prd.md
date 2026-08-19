# 修复本地开发账号引擎资源缺失

OpenSpec change：`fix-local-dev-managed-engine-resources`。

## Goal

让 `npm run tauri:dev` / `npm run tauri:dev:hot` 的 debug resource directory 与已准备的 bundled engine resources 一致，避免登录后 account gate 因 `engineBundleUnavailable` 无法启动 AppShell。

## Requirements

- 启动前同步 `src-tauri/resources/bundled-engines/current` 到 `src-tauri/target/debug/bundled-engines/current`。
- 使用 atomic replace；source 缺失必须 fail-fast。
- `preparing` failure 显示 safe mapped message 和可用的 retry。
- 不改正式 DMG resource、checksum、signing 或 native validation policy。

## Acceptance Criteria

- [x] debug resource tree 包含 manifest 与 Codex/Claude binaries。
- [x] stale debug resource 会被当前 source 替换，legacy symlink 会替换为独立树。
- [x] toolchain failure 显示具体可恢复的用户文案，不泄露实现细节。
- [x] focused tests、typecheck 与 Native focused test 通过；Tauri dev instance 重启后需人工确认 AppShell。
