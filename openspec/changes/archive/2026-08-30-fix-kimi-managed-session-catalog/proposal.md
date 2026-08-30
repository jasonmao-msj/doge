# Restore Managed Kimi Provider-Home History

## Why

managed Kimi provider 的 runtime 会话写入 `.doge/kimi-provider-homes/<provider-id>`，但应用重启后 Kimi history catalog 只扫描默认 `~/.kimi-code`，导致会话文件仍存在却从侧栏和 Session Management 消失。force refresh 只是重复错误 root 的扫描，因此无法恢复会话。

## What Changes

- 让 Kimi history discovery 在未指定 `custom_home` 时同时扫描默认 Kimi home 与 app-local managed provider homes。
- 让 list、load、delete 使用同一 provider-home resolver，保证发现后的会话可以打开和删除。
- 为 discovered managed Kimi rows 返回可选 `providerProfileId`，并把该 metadata 传入 Sidebar/catalog projection；保留旧 local Kimi payload 兼容。
- provider-home 枚举失败时返回可追踪错误，不把 provider-backed history 的缺失伪装成 authoritative deletion。
- 增加 Rust regression tests，覆盖重启后的 managed home discovery、workspace isolation、load/delete root selection 与 explicit `custom_home` compatibility。

## 目标与边界

- 目标：重启后以及 force refresh 后，存在于 managed Kimi provider home 且属于当前 workspace 的会话稳定回到 session catalog。
- 目标：list/load/delete 的 root selection 保持一致，避免发现路径与操作路径分叉。
- 边界：不迁移或复制已有 session 文件，不修改用户 global `~/.kimi-code/config.toml`，不改变 Kimi CLI wire parser。
- 边界：保留现有 `kimi:<sessionId>` frontend identity；provider id 作为 optional metadata，不引入破坏性 IPC 参数变更。

## 非目标

- 不改变其他 engine 的 first-paint 完整 catalog 延迟策略；本 change 仅为 Kimi 增加一次异步 durable-history seed，补齐重启后没有 live signal 的恢复路径。
- 不重写所有 engine 的 provider-home catalog abstraction；仅抽取 Kimi 所需的最小 root resolver。
- 不清理重复、损坏或未知 provider home 中的历史文件。
- 不把 provider home 目录名单独当作 workspace ownership proof；仍以 Kimi index entry 的 `workDir` 严格匹配 workspace。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workspace-session-catalog-projection`：增加 managed Kimi provider-home discovery、source ownership 与操作一致性要求。
- `kimi-engine-runtime`：增加重启后 managed Kimi history 的 list/load/delete root compatibility 要求。

## Impact

- Backend：`src-tauri/src/engine/kimi_history.rs`、Kimi history command callers、`src-tauri/src/session_management*.rs`。
- Frontend：Kimi summary normalization/merge 的 optional provider metadata。
- Daemon：复用同一 Kimi history API，保持 GUI/daemon parity。
- Specs/tests：新增 OpenSpec delta、Trellis task、Rust history/catalog regression。
- 不新增依赖，不改变现有 command 名称或必填 payload。

## 方案对比与取舍

| 方案 | 说明 | 取舍 |
|------|------|------|
| A. 重启时把当前 provider home 写回全局 `EngineConfig.home_dir` | 改动较小，能覆盖单个当前 provider | 拒绝：多个 provider 无法共存，且 global in-memory config 不能可靠表达 provider identity |
| B. 每个 command 由调用方自行拼接 provider home | 可快速补齐某一个入口 | 拒绝：list/load/delete/catalog/daemon 容易再次漂移，错误路径也不一致 |
| C. Kimi history 内部统一 resolver，默认路径扫描 default + managed roots | 所有读写入口共享一致 root discovery，保留 explicit custom home 行为 | 采用：改动集中、兼容性清晰，并能覆盖重启与 force refresh |

## 验收标准

- managed provider home 中的 Kimi session 在应用重启后执行 force refresh 能出现在当前 workspace catalog。
- 不同 workspace 的 Kimi session 不会因扫描 managed home 而互相泄漏。
- discovered session 可正常 load；delete 只删除目标 session 及其所属 index entry，不删除整个 provider home。
- explicit `custom_home` 仍只扫描指定 home，不意外扩大扫描范围。
- GUI 与 daemon 的 list/load/delete 行为一致。
- focused Rust tests、`cargo check --lib`、`npm run typecheck`、`npm run check:runtime-contracts` 与 strict OpenSpec validation 通过。
