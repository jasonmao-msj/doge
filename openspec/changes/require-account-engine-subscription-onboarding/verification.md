## Verification evidence

### token2api authority

- Contract source PR: `jasonmao-msj/token2api#40`, merged to `main` as `7b91d55014b9bf6bb7879d2c70b036966abdd0cb`.
- Production runtime source: `3677f53db22c9983ac720fa422519eaaca268efa`; image `tokenmatrix/sub2api:3677f53db` health=`healthy`, restart count `0`.
- Production descriptor observed at `2026-08-16T09:47:33Z` advertises `passwordReset`, `engineCatalog`, `engineSubscriptionPlans`, `engineSubscriptionCheckout`, `managedEngineAccess`, `subscription_only_engine_checkout_v1`, `managed_engine_binding_v1`.
- CI: PR #40 `test`, `frontend`, `golangci-lint`, `shell`, `backend-security`, `frontend-security` all passed. The unrelated map-order unit-test retry also passed without source changes.
- Managed credential hardening: PR #41 merged；focused service tests cover 24-way concurrent ensure, semantic replay, account/device/engine isolation, and device-id non-persistence，serial unit/integration CI passed.
- Password-recovery descriptor: PR #42 merged；production public settings expose `password_reset_enabled=true` with all supported captcha switches false；synthetic `example.invalid` forgot request returned the neutral HTTP 200 envelope without exposing reset token.
- Production recovery: S3 artifact SHA-256 `6191cfdc4c1fc70ed84ed16f70d414dc49f0e9c99ce5b9d8840a4d64bda3212e`；validated PostgreSQL backup `/opt/token-matrix/backups/doge-password-reset-validated-20260816T094435Z`；encrypted EBS snapshot `snap-02d5c77c9a5f7a800`.

### Doge cross-layer gates

- `npm run lint`: pass with 0 errors; 16 pre-existing hook warnings remain.
- `npm run typecheck`: pass.
- Focused Vitest: router + AccountAppGate + engine wire parser + preference + frontend boundary, 23/23 pass.
- Full frontend `npm run test`: 1097/1097 test files pass；latest focused router/AccountAppGate/engine wire/preference/boundary suite 23/23 pass.
- Full Rust suite: 2076 pass, 2 isolated-live tests ignored by their explicit test contract.
- Rust account tests after password-recovery request wiring: 73 pass, 2 isolated-live tests ignored by their explicit test contract.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass.
- `npm run check:runtime-contracts`: pass.
- `npm run doctor:strict`: pass, including branding check.
- `openspec validate require-account-engine-subscription-onboarding --type change --strict --no-interactive`: pass.

### Production behavior assertions

- Doge renders exactly the `plans` array returned by the authenticated engine-plan projection; empty means empty, with no local fallback pricing.
- `balance`, `recharge`, pay-as-you-go, and API-key selection are absent from the mandatory product path.
- Existing entitlement startup performs an idempotent managed-access ensure before AppShell mount, so a stale local credential cannot bypass current subscription binding.
- Engine-scoped launch reads require the current active account session and no longer depend on the legacy `managed_key_id`; focused Rust coverage proves first-use launch succeeds and signed-out launch fails closed.
- Nullable Rust wire fields (`expires_at`, checkout action `url/data`) have a real-shape regression test to prevent false `protocolMismatch`.
- `sessionChanged` to signed-out unmounts AppShell; a regression test proves the mandatory gate reasserts after session loss.
- Password recovery 首期边界已冻结为 Doge 发起 neutral forgot request、固定 `token-matrix.com` HTTPS 页面完成 reset、用户返回 Doge 重新登录；Native/renderer 不接收 raw reset token，Desktop ticket completion 未上线前不虚假启用。

### 2026-08-17 bundled-engine follow-up

- Build-time bundle 固定为 Codex `0.147.0` 与 Claude Code `2.1.233`，manifest 对每个 target 记录官方 artifact URL 与 SHA-256；prepare script 覆盖 cache、target alias、universal expansion、archive traversal rejection 与 runtime manifest generation。
- Runtime selection matrix 已冻结并由 Rust/TypeScript 双侧验证：未发现 external installation 时静默使用 bundled；external 同版或更高时静默保留用户版本；bundled 较新时展示一次二选一，不覆盖、不改名、不卸载用户安装。
- Claude account-managed binary 使用 provider-scoped runtime override；local/manual provider 继续使用用户配置。Codex account launch 只在当前 account session 中读取 managed path；daemon 对 account-managed Claude send/compact 均 fail closed，避免 fallback 到错误的 global binary。
- Windows NSIS 使用 `currentUser`；existing target replacement 使用 Windows `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` 并保留 access denied / busy / unsafe stable reason；跨平台 atomic replacement regression 已通过。
- Focused frontend suites 26/26 pass；frontend boundary + toolchain 6/6 pass；Rust account 82 pass、2 isolated-live tests ignored；build-script tests 4/4 pass（含 Windows temp/workspace cross-volume staging regression）；`npm run typecheck`、`npm run lint`（0 errors，16 pre-existing warnings）、`npm run check:runtime-contracts`、`cargo fmt -- --check` 与 OpenSpec strict validation 均 pass。
- Full `npm run test` 在 unrelated `context-ledger/costProjection.test.ts` 的两项 date-sensitive pricing assertion 失败：测试 fixture 只覆盖到 2026-05，而当前日期为 2026-08；本 change 的 account/bundle suites 全部通过，未扩大范围修改 pricing baseline。
- Latest local macOS arm64 artifact: `release-local/doge_0.1.0_aarch64.dmg`，`249573620` bytes，SHA-256 `80a84be06abc072e56795bc46deb218437b007c403dd0beeb8ba9558e4776570`；`hdiutil verify`、App `codesign --verify --deep --strict`、所有 bundled engine nested binaries、arm64 architecture 与 exact version probes 均 pass。该体验包为 ad-hoc signature、未 notarize。

### Release evidence 与 remaining manual gates

- macOS final run: `https://github.com/jasonmao-msj/doge/actions/runs/31944142977`，source `9bddd5b0c1cc31baf9a2f2817028204afaf79d6e`，arm64 与 x86_64 jobs 均 success。
- macOS arm64: `release-local/github-31944142977/doge-macos-aarch64-adhoc/doge_0.1.0_aarch64.dmg`，SHA-256 `2ba174b6712b2ac89a8512d8177a285dff13e1a998f5c3953e9de3b1fb5571cb`；portable sidecar `shasum -c`、`hdiutil verify`、App/main/daemon/OpenSSL arm64、无 Homebrew absolute dependency、`codesign --verify --deep --strict`、sealed resources v2（261 files）与 native 8s launch smoke 均 pass。
- macOS x86_64: `release-local/github-31944142977/doge-macos-x86_64-adhoc/doge_0.1.0_x86_64.dmg`，SHA-256 `3289c44e6683eb9e949a4ed0a1310a886b5e26ee4f949b77000d398a7e81fef5`；portable sidecar、DMG、四个 Mach-O x86_64、无 Homebrew absolute dependency、deep/strict codesign、sealed resources v2（261 files）与 Apple Silicon Rosetta 8s launch smoke 均 pass。
- macOS signing 由内到外固定为 OpenSSL dylibs → daemon → main → App；PR #10 修复 Intel 对未签名 nested daemon 的 fail-closed rejection，并同时覆盖 ad-hoc 与 Developer ID paths。两份 build status 均为 `signature=adhoc`、`notarization=not-submitted`。
- Windows final run: `https://github.com/jasonmao-msj/doge/actions/runs/31946059530`，source `53e07446372bc9c59e1fb0f65a634b476736bc96`；Windows runner 启动 `doge.exe` 8 秒并记录 `windows_launch_smoke=alive pid=6040` 后才 staging artifact。
- Windows installer: `release-local/github-31946059530/doge-windows-x64-unsigned/doge_0.1.0_x64-setup.exe`，SHA-256 `7278e77175f57ae6ba8fb2fbd6f578669d13baf84c2fa89758ba0fa62b9478e5`；portable LF sidecar `shasum -c`=pass，NSIS PE Security Directory 为 `0/0`，与 `unsigned` 标记一致。
- PR #8 / #9 把 Windows checksum 固定为 BOM-free ASCII + LF，并让 macOS sidecar 只记录 basename；下载后的三份 sidecar 均由标准 `shasum -c` 直接验证。
- controlled-account payment/managed-access/Codex/Claude launch smoke 与完整 visual/accessibility platform matrix 尚待专用测试账号和人工目视，不因 artifact green 越级声称完成。
- Apple Developer ID, notarization credentials, Windows code-signing certificate, and Tauri updater private key are not configured in the GitHub `release` environment. macOS artifact-only builds明确标记 ad-hoc/not-notarized，Windows 标记 unsigned；两者都不代表 formal signed release。
