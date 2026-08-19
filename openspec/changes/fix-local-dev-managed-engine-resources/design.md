## Context

managed engine startup 先调用 `account_engine_v1_toolchain`。Native resolver 从 Tauri `resource_dir/bundled-engines/current/manifest.json` 读取 manifest，再验证 selected binary。开发态 resource directory 是 `src-tauri/target/debug`，而产品资源位于 `src-tauri/resources/bundled-engines/current`。

## Decision

在 `ensureTauriDevResourcePlaceholders()` 中增加受控的 directory sync：source 为仓库内已有的 `src-tauri/resources/bundled-engines/current`，destination 为 `src-tauri/target/debug/bundled-engines/current`。同步先准备 temporary sibling，再以 real copied tree（macOS 优先 APFS clone）在应用启动前替换 destination；不能使用 symlink，因为 Tauri 后续资源复制会将 source/destination 解析为同一文件并截断 source。保留 `bundled-engines/.gitkeep` 作为 Tauri resource glob 的目录锚点。

`beforeDevCommand` 先执行 `prepare:bundled-engines`。该脚本复用 checksum-verified `.cache/bundled-engines` archives，只有 cache 缺失或 checksum 不匹配时才下载；这样 fresh checkout、被清空的 generated resource 和直接 `tauri dev` 都遵守同一准备链。

不在 Native resolver 为 debug build 放宽 manifest/binary validation，也不让 renderer 绕过 toolchain inspection。这样开发态继续覆盖与 release 相同的 resource contract，只修复缺失的 staging。

## Account Activation Cache Boundary

`account_engine_v1_toolchain` 已在 Native 侧完成 manifest、路径边界和 `--version` verification，并只将通过校验的 binary 记录在当前进程的 `AccountRuntime`。但其后的 renderer `switch_engine` 仍依赖通用 `EngineManager.engine_statuses` cache；后台 global detection 可以把这个 cache 覆盖为用户配置或 PATH 对应的 unavailable status，导致已验证的账号 binary 被错误拒绝。

新增 `account_engine_v1_activate` 对 Codex / Claude 检查当前进程是否存在同一 engine 的 verified managed binary。存在时重新验证该 binary 并仅设置 active engine，不重新依赖 global status cache；不存在时拒绝 activation。普通 `switch_engine` 维持既有 installed check。该 account-scoped command 不接收 renderer 传入的 executable path，且 mapping 只由已经完成 Native toolchain verification 的命令写入。

## Failure Matrix

| 场景 | 预期 |
|---|---|
| source resources 完整 | debug resource directory 含 manifest 与二进制，toolchain 可继续验证 |
| source resources 缺失、为空或 manifest 非法 | beforeDev 先重新 prepare，再进入 debug staging |
| source resources 缺失 | dev command 在启动前失败，并报告 source path |
| previous debug resources stale | next sync 原子替换为 source 的当前内容 |
| toolchain/network/vault/configuration 失败 | gate 显示 mapped safe message 和 retry，不泄露 native path、secret 或 raw error |
| toolchain 已验证但 global status cache 为 unavailable | account engine 仍可激活；普通 engine switch 继续执行 installed check |
| packaged DMG | 不经过 dev sync，保持现有 bundle 验证与签名链 |
