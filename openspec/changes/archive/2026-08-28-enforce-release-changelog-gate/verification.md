# Verification: enforce-release-changelog-gate

## Outcome

`CHANGELOG.md` authority、version parity、target-tag collision、bounded batched CI recovery 与 signed Release
链路已通过真实 `v0.1.10` 发布验证。

- Release：https://github.com/jasonmao-msj/doge/releases/tag/v0.1.10
- Release workflow：https://github.com/jasonmao-msj/doge/actions/runs/33173561758
- Green main CI：https://github.com/jasonmao-msj/doge/actions/runs/33170451643
- Published commit：`cdd7ecb29a3e4abb79ca15868f12916cbea9cc5a`

## Preparation Evidence

| Surface | Evidence | Result |
|---|---|---|
| CHANGELOG/version gate | `npm run release:check` | `v0.1.10`, 5 entries, pass |
| Parser negative matrix | `npm run release:check:test` | 3/3 pass |
| App offline parser | `useReleaseNotes.test.ts` + production `CHANGELOG-*.js` | current entry bundled |
| Workflow contract | `release-workflow.contract.test.mjs` | tag/changelog/permissions pass |
| Legacy tag collision | origin `v0.1.4` → `eba30a399...` | blocked；selected unused `v0.1.10` |
| Release preparation | PR #45 | merged |

## CI Stabilization Evidence

首次 main CI 在不同 runners/features出现 independent timing races；未通过 blind rerun绕过：

- PR #46：Windows full batched Vitest启用 bounded retry 1，默认 timeout保持 5000ms。
- PR #47：Unix hanging probe test改为在 cleanup budget内等待 descendant `ESRCH`；production kill/deadline不变。
- PR #48：同型 timeout在 Ubuntu `test-js` 复现后，将 bounded retry校准到两个 full batched CI lanes。
- Final main CI `33170451643`：lint、docs、typecheck、memory-kind、test-js、test-windows、test-tauri、build-macos全通过。
- Focused Rust hanging-probe regression连续 10/10通过；Windows batch完成 1135 test files。

## Signed Release Evidence

Run `33173561758` 从 `main` 显式使用：

- `windows_artifact_only=false`
- `macos_artifact_only=false`

成功 jobs：release preflight、macOS aarch64/x86_64、Linux AppImage x86_64、Windows x64、Web assets、release publish。

Published assets：

- `doge_0.1.10_aarch64.dmg`
- `doge_0.1.10_x86_64.dmg`
- `doge_aarch64.app.tar.gz` + `.sig`
- `doge_x86_64.app.tar.gz` + `.sig`
- `doge_0.1.10_amd64.AppImage` + `.sig`
- `doge_0.1.10_x64-setup.exe` + `.sig`
- `doge-web-assets_0.1.10.zip` + `.sha256`
- `latest.json`

## Final Consistency

- Release：non-draft、non-prerelease、latest。
- `v0.1.10` tag精确指向 published commit `cdd7ecb29...`。
- `latest.json.version = 0.1.10`。
- `darwin-aarch64`、`darwin-x86_64`、`linux-x86_64`、`windows-x86_64` URLs与 signatures均非空。
- GitHub Release body、`latest.json.notes` 与 committed `CHANGELOG.md` current entry双语一致。
- 无未覆盖的 release/signing/platform gate；GitHub Actions的 Node runtime deprecation annotation不属于本 change failure。
