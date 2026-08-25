# Verification

## Level

`L2 Feature/Test Harness`：只修改 Project Map tests，但目标是 Windows batched CI stability。

## Passed

- `npx vitest run src/features/project-map/components/ProjectMapNavigationPanel.test.tsx src/features/project-map/utils/navigation.test.ts src/features/project-map/components/ProjectMapPanel.test.tsx`
  - 3 files passed
  - 57 tests passed
  - leaf disclosure test: 51ms
  - full `ProjectMapPanel.test.tsx`: 51 tests / 8.4s aggregate, no single 5s timeout

## Pending

- none

## Additional passed gates

- target ESLint：pass
- `npm run typecheck`：pass
- `npx openspec validate stabilize-project-map-windows-test-latency --strict --no-interactive`：pass
- `npm run check:docs`：pass
- `git diff --check`：pass

## Release artifacts

- Workflow：[run 32835675677](https://github.com/jasonmao-msj/doge/actions/runs/32835675677) → `success`
- Windows x64 unsigned NSIS：`doge_0.1.0_x64-setup.exe`
  - SHA-256：`aebc67cc74a00d641a37fe7a05ea0fb252578ed37769434bb885e79e7a6ff007`
- macOS aarch64 ad-hoc DMG：`doge_0.1.0_aarch64.dmg`
  - SHA-256：`4c15e6cff9befcecd1c8354bb4eaa5c51160d05624ac8f2c574f5115aaf680a7`
  - `hdiutil verify`：VALID
- macOS x86_64 ad-hoc DMG：`doge_0.1.0_x86_64.dmg`
  - SHA-256：`f45001aba56659f0e3d3d930f68b993e771155cc182fc217a761b9027f5e60d4`
  - `hdiutil verify`：VALID
- macOS status：`signature=adhoc`、`notarization=not-submitted`
- Local delivery：`/Users/jason/Downloads/doge-release-32835675677`
