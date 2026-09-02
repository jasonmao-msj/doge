# Verification: add-wechat-bridge-channel

## Verification Level

`L3 Cross-layer / High-risk`。本 change 修改 React settings、TypeScript IPC contract、
Tauri command registry、Rust process/local HTTP lifecycle、provider persistence 与 cross-platform packaging。

## Automated Evidence

- `cargo test --manifest-path src-tauri/Cargo.toml --bin wechat-bridge`：通过，6 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib wechat`：通过，20 tests；覆盖 command parser、无效数字、per-`wxid` target/pending persistence、联系人隔离、legacy route fallback 与无 global target 启用。
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`：通过；仅有仓库既有 warnings。
- `npm run prepare:wechat-bridge`：通过；生成 Windows x64 release sidecar（3,091,456 bytes）及 Tencent provider manifest。
- packaged sidecar `/health` smoke：显式移除 `DOGE_WECHAT_PROVIDER_API_KEY` / `DOGE_WECHAT_PROVIDER_PROXY_URL` 后返回 `ok=true`、provider=`@tencent-weixin/openclaw-weixin`、version=`2.4.6`、固定 integrity。
- Node target mapping smoke：通过 macOS arm64/x64/universal、Windows x64、Linux arm64/x64 mapping。
- `npx vitest run src/features/settings/components/settings-view/sections/WechatChannelSettings.test.tsx src/services/tauri/wechat.test.ts`：通过，2 files / 9 tests。
- `npx vitest run src/features/composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners.test.tsx`：通过，31 tests；验证 provider-scoped create-session catalog owner。
- `npx vitest run src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx`：通过，60 tests；验证 atomic engine/provider/model 切换与完整 `ExecutionTarget`。
- `npx vitest run src/features/composer/components/ChatInputBox/selectors/ProductEngineModelSelect.test.tsx`：通过，8 tests；验证 Product engine/model picker 与 canonical managed target。
- `npm run typecheck`：通过。
- targeted ESLint（WeChat component/test/service/types）：通过。
- `npm run check:runtime-contracts`：通过。
- `npm run check:large-files`：report mode 完成且命令 exit 0；仓库当前报告 97 个 baseline/new-file ratchet 项，其中新增 `src-tauri/src/wechat/mod.rs`（1702 lines）与 `target_commands.rs`（871 lines）超过 800-line new-file threshold，作为后续结构治理 debt 保留。
- `node --test scripts/tauri-dev-resources.test.mjs`：通过，6 passed / 1 Windows symlink case skipped。
- `npx openspec validate add-wechat-bridge-channel --strict --no-interactive`：通过。
- `rustfmt --edition 2021 --check src-tauri/src/bin/wechat_bridge.rs src-tauri/src/wechat/mod.rs`：通过。
- `git diff --check`：通过。

## Covered Behavior

- bundled sidecar 直接对接 Tencent iLink，不读取 provider API key/proxy URL；health 暴露固定 provider name/version/integrity。
- QR、`wait` / `scaned` / `need_verifycode` / redirect / confirmed / expired status mapping 与 1-8 位验证码提交。
- `notifystart`、`getupdates` cursor、direct text parse、peer context token persistence 与 `sendmessage` payload。
- redirect host allowlist、Windows atomic replacement、Unix owner-only permission implementation。
- webhook auth、msg ID dedupe、stable wxid session routing、Unicode reply chunking 与 ledger persistence。
- 开启渠道自动启动 bundled process 并自动获取 QR；UI 使用 `qrcode` 生成图片、按需显示验证码输入，不暴露 bridge/provider config。
- 设置页不再展示 workspace / engine / model routing selector；渠道启停不要求或推导 global execution target。
- 微信联系人通过 `/target`、`/workspace`、`/engine`、`/model`、`/cancel` 与数字回复独立选择 target；pending 控制消息在 agent dispatch 前消费，selected target/pending state 按 `wxid` 持久化。
- Product-ready 候选使用与会话页相同的 protocol compatibility、managed provider binding 与 runtime model normalization；非 Product 候选来自 provider-scoped backend catalog，并原子保存 catalog id、runtime model 与 provider profile。
- `wechat_submit_login_verify` 已贯通 Rust registry -> TypeScript service/type -> React UI。
- packaging manifest 固定 `@tencent-weixin/openclaw-weixin@2.4.6` npm integrity，Tencent MIT notice 随资源目录打包。
- Windows startup regression：实测 OS credential vault 返回 `locked or unavailable`；内部 API key/webhook token 已迁移为每次 runtime start 随机生成的 in-memory secrets，bridge 自动启动不再依赖系统 vault，stop 时清除。
- Windows restart smoke：已启用渠道在 Doge 启动后自动拉起 bundled bridge，`127.0.0.1:18789` / `18790` 监听正常；`/health` 返回固定 Tencent provider identity。

## Not Covered

- 未使用真实手机完成微信扫码、数字验证码、direct text inbound 与 Doge reply outbound；该项仍需真实设备 smoke，不能由 mock 替代。
- `http://localhost:1420/` 的 in-app browser 当前停在「服务暂时不可用」startup gate，无法进入设置页完成本轮 live visual QA；组件结构与 selector 移除由 focused Vitest 覆盖。
- 当前主机只实际 build/smoke Windows x64；macOS/Linux source/target mapping 已验证，但对应 target build、签名、安装包启动与 filesystem permission smoke 属于 Release/CI。
- 未运行 full `npm run test`、full Rust suite 或正式 installer build；这些属于 L4 Release/CI scope。

## Archive Decision

2026-09-01 用户明确要求归档并提交 PR。change 在 L3 focused gates 通过后归档；真实设备
扫码/收发 smoke 与 macOS/Linux package smoke 保留为 release/manual residual，不将其记录为已通过。
