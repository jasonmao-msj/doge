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

### Release evidence 与 remaining manual gates

- macOS arm64 final-source artifact-only build: `/release-local/doge_0.1.0_aarch64.dmg`，SHA-256 `f1980e9ab5632a4b4b1b8466bdb10c8f2d06e9f25d89386917e63b25656506c0`；`hdiutil verify`=VALID，App/main/daemon/OpenSSL 均为 arm64，binary 不含 Homebrew absolute dependency。
- OpenSSL fixup 后显式 ad-hoc sign nested dylibs/main/daemon/App；mounted App `codesign --verify --deep --strict`=pass，sealed resources v2（261 files），受控 `open -n` 启动 smoke 观察到 main process 正常存活后主动退出。`spctl` 按预期拒绝无 Developer ID/notarization 的内部包，因此它不宣称 formal release。
- controlled-account payment/launch smoke、visual platform matrix、macOS x64 与 Windows x64 artifact checksums are appended before change closure.
- Apple Developer ID, notarization credentials, Windows code-signing certificate, and Tauri updater private key are not configured in the GitHub `release` environment. macOS artifact-only builds明确标记 ad-hoc/not-notarized，Windows 标记 unsigned；两者都不代表 formal signed release。
