## Why

`tauri dev` 的 native `resource_dir` 指向 `src-tauri/target/debug`。现有开发启动只创建了 bundle glob 所需的空目录，导致该目录中的 `bundled-engines` 仅含 `.gitkeep`；已登录且有权益的用户在启动 gate 中执行 toolchain inspection 时返回 `engineBundleUnavailable`，无法进入 AppShell。正式 DMG 则携带完整资源，因此表现不同。

## What Changes

- 开发启动 SHALL 先准备 bundled engine source，再同步该目录到 Tauri debug `resource_dir`。
- 同步 SHALL 先完成 staging，再在应用启动前替换为当前资源版本，不能保留上一次的 stale files；源资源缺失时必须显式失败，不能生成空的成功结构。
- Account gate 在 `preparing` 状态失败时 SHALL 展示 renderer-safe 的已映射原因与重试动作，不能只显示通用标题。
- Account gate 在 toolchain 已验证账号引擎后 SHALL 不再被无关的全局 engine status cache 阻断激活。
- 正式 bundle 的 resource、checksum、binary verification 与签名流程不变。

## Impact

- `scripts/tauri-dev-resources.mjs` 和其 Node test：开发资源同步。
- `src/features/account/components/AccountAppGate.tsx` 和 focused test：准备失败的可见反馈。
- `src-tauri/src/engine/{commands,manager}.rs`：账号已验证二进制的激活边界。
- 新 capability `local-development-managed-engine-resources`：开发态与 packaged resource resolution 的契约。
