# Verification: Enable doge Remote Updater

## Verification Level

L3 Cross-layer / High-risk。变更覆盖 Tauri shipping config、GitHub Actions release artifact/signature contract、frontend updater state machine，以及 Windows/macOS artifact-only build path。

## Executed Checks

- `npm exec -- vitest run src/features/update/hooks/useUpdater.test.ts src/features/update/components/UpdateToast.test.tsx src/features/update/updateReleaseConfig.test.ts src/features/brand/contracts/brandManifest.test.ts src/features/brand/contracts/externalServiceContracts.test.ts src/features/brand/contracts/upstreamServiceIsolation.test.ts`
  - 6 files passed, 35 tests passed。
- `npx eslint src/features/update/hooks/useUpdater.ts src/features/update/hooks/useUpdater.test.ts src/features/update/components/UpdateToast.tsx src/features/update/components/UpdateToast.test.tsx src/features/update/updateReleaseConfig.test.ts src/features/brand/contracts/brandManifest.test.ts src/features/brand/contracts/externalServiceContracts.test.ts src/features/brand/contracts/upstreamServiceIsolation.test.ts`
  - passed。
- `npm run typecheck`
  - passed。
- `node --check scripts/build-platform.mjs`
  - passed。
- `node --test scripts/release-workflow.contract.test.mjs scripts/lib/brandingChecker.test.mjs`
  - 11 tests passed。
- `npm run check:branding`
  - passed。
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`
  - passed；保留既有 Rust warnings，无本 change 相关 error。
- `openspec validate enable-doge-remote-updater --strict --no-interactive`
  - passed。
- `git diff --check`
  - passed。

## Not Covered

- 未生成或写入 `TAURI_SIGNING_PRIVATE_KEY`；GitHub `release` environment secrets 尚未在本地读取。
- 未在本机生成正式 Windows/macOS installer，也未完成真实两版本 update smoke；该项保留给 GitHub Actions 与发布者的 L4/platform acceptance。
- 未运行全量 `npm run test`、全仓 `npm run lint` 或跨平台 release build；这些属于 L4 Release/CI gate。
