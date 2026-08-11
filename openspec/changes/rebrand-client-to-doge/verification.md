# Verification — rebrand-client-to-doge

> Status: implementation verification in progress. This record separates completed evidence from release work that still requires signing credentials, GitHub Actions, or platform smoke testing.

## Scope and safety boundary

- Product identity: lowercase `doge`, version `0.1.0`, bundle identifier `io.github.jasonmao-msj.doge`.
- Current storage writes use `~/.doge`, doge bundle data, doge local keys, and doge protocol markers.
- Legacy ccgui/MossX/CodeMoss names remain only in explicit migration readers, compatibility writers, historical records, legal provenance, or developer-only upstream sync tooling.
- Shipping runtime has no upstream updater key, Baidu analytics transport, upstream managed relay, or upstream product links.
- Automatic updates remain disabled and release automation fails closed until an independent doge updater key and required signing secrets are configured.
- No cloud application server is required for the initial client-only distribution model. GitHub Releases is the intended download and static update-feed host.

## Git and local environment

| Check | Result |
| --- | --- |
| Branch | `chore/rebrand-client-to-doge` |
| `origin` | `https://github.com/jasonmao-msj/doge.git` fetch/push |
| `upstream` | upstream repository fetch; push URL is `DISABLED` |
| repo-local Git identity | `Jason <56750302+jasonmao-msj@users.noreply.github.com>` |
| Rust/Cargo | `1.97.1` |
| CMake | `4.4.2` |
| Node/npm | `v24.15.0` / `11.12.1` |
| Apple toolchain | Command Line Tools installed; full Xcode is not installed |

The tracked upstream audit helper is read-only: it inspects local remote configuration and never fetches, pushes, or rewrites Git state.

## Completed automated evidence

| Area | Command or suite | Result |
| --- | --- | --- |
| Canonical brand | brand manifest + config contracts | pass, 5 brand-contract files / 43 tests; Community UI regression 2/2 |
| Upstream services | external-service and product-link contracts | pass; no shipping upstream analytics, relay, updater trust, or product URL |
| Branding gate | `npm run check:branding` | pass |
| Branding checker | `npm run check:branding:test` | pass, 4/4 |
| Icon inventory | `npm run check:icon-assets` | pass, 6/6 |
| Upstream topology | `git fetch upstream main`, compare, and upstream audit | pass; local branch was 2 commits ahead / 0 behind at rehearsal time; upstream push remains disabled |
| Documentation | `npm run check:docs` | pass, 155 prose files and 35 JSON files |
| Runtime contracts | `npm run check:runtime-contracts` | pass |
| Environment doctor | `node scripts/doctor.mjs --strict` | pass |
| TypeScript | `npm run typecheck` | pass, no diagnostics |
| ESLint | `npm run lint` | pass, 0 errors; 16 pre-existing hook dependency warnings |
| Storage migration | focused `app_paths::tests` | pass, 16/16 |
| Daemon compatibility | daemon and web-assets focused Rust suites | pass, current doge identity first with legacy read fallback |
| Rust integration targets | `cargo test --manifest-path src-tauri/Cargo.toml --test '*'` | pass, 92/92 |
| Rust compilation | `cargo test --manifest-path src-tauri/Cargo.toml --no-run` | pass after changing integration references to `doge_lib` |
| OpenSpec change | `openspec validate rebrand-client-to-doge --strict --no-interactive` | pass |

Focused frontend coverage also includes localStorage migration, user-visible locale inventory, About/Error links, updater fail-closed behavior, note-card doge paths, app-server behavior, and existing touched-file regression suites.

The rendered 660×400 DMG background and the 32×32/1024×1024 app icons were visually inspected on 2026-08-10. The install arrow, Applications target, bilingual instruction, icon silhouette, alpha edge, and safe-area spacing are legible without clipping. The DMG background is approved for the current unsigned-build smoke; replacement UI screenshots remain outstanding.

## Full-gate results

### Frontend

The repository contains 1,074 non-integration Vitest files. The full runner intentionally uses isolated four-file batches with one worker to prevent state leakage and excessive memory use.

- Files 1–580: one stale `.ccgui` path expectation was found and updated; its focused suite passes 18/18.
- Files 581–688: one web-assets settings test reached its 5-second timeout under full load. The exact test then passed twice independently with a 69 ms test body each time, so no production behavior was changed.
- Files 689–1,074: 386/386 files and 3,563 tests passed.
- Complete segmented inventory: 1,074/1,074 files; 9,005 passed tests, 2 intentional skips, 0 unresolved failures.

The inventory is a resumable segmented full run rather than one uninterrupted command. This distinction is retained because the repository runner stops at the first failing four-file batch.

### Rust

- `source ~/.zshrc && cargo test --manifest-path src-tauri/Cargo.toml`: pass, exit 0.
- Library tests: 2,006 passed / 0 failed.
- `doge_daemon` tests: 1,139 passed / 0 failed; main `doge` target has no unit tests.
- Eleven integration targets: 92 passed / 0 failed.
- Doc tests: pass, 0 tests.

An earlier invocation without the repository's standard shell environment failed before compiling doge because `openssl-sys` could not discover Homebrew OpenSSL. Loading `~/.zshrc`, as documented by the local setup, restored `OPENSSL_DIR` and the authoritative full test completed successfully.

### macOS debug launch

- `source ~/.zshrc && npm run tauri:dev:hot` compiled and launched `target/debug/doge`.
- The first smoke found a real startup blocker: missing updater plugin config was deserialized as `null`. The disabled configuration now uses a valid empty `{ endpoints: [], pubkey: "" }` object, while updater artifacts remain disabled and release preflight still rejects activation.
- Focused updater/release contracts pass after the fix: 2 Vitest tests, 3 Node workflow tests, branding gate, and 4 branding-checker tests.
- The second smoke reached the running doge process without a setup panic.
- After macOS was unlocked, a bundled debug app was built with `npm run tauri -- build --debug --bundles app` and inspected through Computer Use. The cold debug bundle build completed in 1m39s after the 16.96s frontend build; subsequent builds reuse this target cache.

Computer Use manual checklist on 2026-08-10:

| Surface | Evidence | Result |
| --- | --- | --- |
| App/window identity | app `doge`, bundle `io.github.jasonmao-msj.doge`, window `doge - workspace` | pass |
| Home | main navigation, workspace migration data, composer and Home heading rendered | pass |
| Settings | Basic Settings and its appearance, behavior, open method, Web Service and mail sections rendered | pass |
| Community/About | `doge 0.1.0`, canonical tagline, localized AI Shiba story, GitHub and Report Issue actions rendered | pass |
| Upstream support isolation | the smoke exposed an upstream WeChat/official-account QR residual; the QR asset, component, styles and all 10 locale strings were removed; rebuilt app no longer renders an image or upstream support copy | pass after fix |
| Update disabled state | Check for Updates reports `Updater does not have any endpoints set`; no upstream endpoint fallback occurs | pass, fail closed as designed |
| Native app menu | `关于 doge`, `检查更新…`, `设置…`, `Hide doge`, `Quit doge`; native About window title `关于 doge` | pass |

The accessibility tree and Computer Use screenshots were used for inspection. Screenshots containing local workspace names were not committed, so private local project/session data is not turned into repository evidence. Tasks 5.5, 5.6, and 9.5 are complete; README-safe product screenshot work remains task 6.5.

### macOS ARM64 unsigned artifact

- `npm run build:mac-arm64 -- --skip-sign --skip-notarize` completed the production frontend and ARM64 release compilation. The first cold release compile took 8m17s.
- The first bundle attempt exposed that Tauri also derives sidecar identity from the `src/bin/*.rs` filename. The daemon entry and module directory were renamed to `doge_daemon`; the strengthened build contract now has 6/6 passing tests.
- `npx tauri bundle --target aarch64-apple-darwin --bundles app --no-sign` then produced `doge.app` successfully.
- `scripts/create-dmg.sh` now bounds Finder AppleScript calls and falls back to an `/Applications` symlink when the desktop is locked; the final DMG was generated successfully.
- Artifact: `release-local/doge_0.1.0_aarch64.dmg`, 33 MB, SHA-256 `47b65ecfb0e9b99be419b5d134b3935c37c523d435cf9aba9c788a478a0acce5`.
- `hdiutil verify`: valid checksum. A read-only mount contains `doge.app` and an `/Applications` link.
- Bundle inspection: identifier `io.github.jasonmao-msj.doge`, display name `doge`, version `0.1.0`; `doge`, `doge_daemon`, `libssl.3.dylib`, and `libcrypto.3.dylib` are all Mach-O arm64.
- Both binaries resolve OpenSSL through `@rpath`; no `/Users`, `/opt/homebrew`, or `/usr/local` library reference remains. The build flow now bundles OpenSSL even when signing is skipped.
- This is explicitly an **unsigned local verification artifact**, not a distributable release. Task 9.6 remains open because Developer ID signing, full Xcode, notarization, and final signature verification were not available.

## Release workflow evidence

Static contracts verify that:

- release preflight runs before any build matrix;
- updater artifacts cannot be created while updater support is disabled or the doge public key is absent;
- missing signing secrets stop the release before artifacts or `latest.json` are published;
- macOS, Linux, and Windows signature files must all be present and non-empty;
- release artifacts and GitHub URLs use doge-owned names and `jasonmao-msj/doge`;
- local build failures are propagated instead of being misclassified as signing warnings;
- macOS signing identity must be supplied explicitly and no upstream personal identity is used.

The updater is deliberately **not enabled** by this evidence. It proves the disabled state fails closed.

### Windows x64 internal installer artifact

- GitHub Actions run [`31449894326`](https://github.com/jasonmao-msj/doge/actions/runs/31449894326) executed commit `1b15c72060b4dc972823164d033000b65f801764` from `chore/rebrand-client-to-doge` with `windows_artifact_only=true`.
- Only `doge windows artifact-only (x64)` ran; updater preflight, signed release matrix, metadata generation and GitHub Release publishing were skipped. The Windows job completed successfully in 37m52s.
- Actions artifact `doge-windows-x64-unsigned` (artifact id `9086537783`) contains the NSIS installer and SHA-256 file and expires on 2026-08-25.
- Local download: `release-local/windows/doge_0.1.0_x64-setup.exe`, 27,981,697 bytes.
- SHA-256: `859b683d2aabf8ed4813750901e1d385d25d840b7413dd0ec37ad8f278691bce`; checksum verification passed after normalizing the checksum file's Windows CRLF line ending for macOS `shasum`.
- `file` identifies the result as a Windows GUI PE / Nullsoft self-extracting installer. It was built on `windows-latest` using the doge Windows Tauri config and NSIS target.
- This artifact is explicitly unsigned and intended for internal installation smoke only. No Windows launch test, Authenticode signature or updater signature has been claimed, so task 9.7 remains open.

## Known repository-wide validation blockers

- `openspec validate --all --strict --no-interactive` currently reports 533 passing changes and 4 failures outside this change: `add-sub2api-relay-quota`, `fix-ui-scale-native-zoom-freeze-all-platforms`, `fix-windows-cold-start-freeze-residual`, and `retire-canvas-subagent-squad-grid`.
- The repository consistency wrapper references `/Users/jason/.claude/skills/osp-openspec-sync/scripts/validate-consistency.py`, which is not installed on this host. The failure is a missing host dependency, not a validation result for this change.
- `npm run check:large-files` is a reporting/ratchet command and reports 73 existing or tracked large-file items; it exits successfully and is not a rebrand failure.

## Not yet verified

The following claims must not be treated as complete until their tasks have direct evidence:

- Developer ID signed/notarized macOS ARM64 production bundle and final code-signature inspection;
- replacement README product screenshots captured from a running doge build;
- Windows launch smoke plus signed installer verification, and Linux GitHub Actions artifact/launch smoke;
- doge updater key generation, GitHub secret configuration, signed draft release, `latest.json`, and two-version update smoke;
- invalid-signature updater rejection in the final enabled configuration.

Until those items are completed, the change is implementation-complete only for the verified local surfaces and is not archive-ready or release-ready.

`npx tauri info` confirms that the missing full Xcode installation is the current local blocker for authoritative macOS bundle/signing verification; it does not block the debug-app smoke path already proven by the baseline.
