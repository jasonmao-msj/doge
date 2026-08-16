# token2api Account Integration — macOS Local Package Readiness

> 状态：`historical-preflight / superseded-by-../verification.md`。本文保留实施前环境与风险快照；当前 source/package evidence 以 `../verification.md` 为准。
>
> 复核日期：2026-08-12；目标主机：macOS 26.5.2 / Apple Silicon (`arm64`)。
>
> Project role：`build-ci-engineer`。本文只预检当前 build/package chain，不代表已构建、签名、安装或通过 token2api Real integration。

## 1. Executive Verdict

当前 doge 的 macOS ARM64 unsigned packaging chain **有近期成功 evidence**：`openspec/changes/rebrand-client-to-doge/verification.md` 记录了 2026-08-10 使用 `npm run build:mac-arm64 -- --skip-sign --skip-notarize` 产出并检查 `doge.app` / DMG；本机仍保留同 checksum 的历史 `release-local/doge_0.1.0_aarch64.dmg`。该证据只证明 rebrand 后的既有链路，不证明 token2api integrated package 已可交付。

首个 token2api 本地试用包当前为 **NOT READY**，blocking reasons 是：

1. Formal `design.md` 已冻结 G0 architecture、logical flags 和 M0/A0 verdict，但 `tasks.md`、G1 executable contracts/shared scenarios、G2–G4 review/conformance、G5 Real integration 与 G6/A0 package acceptance 尚未落盘或通过。
2. 当前 source 没有 Account feature、Real adapter、Native Broker、OS vault abstraction 或可执行的 production account flag/origin config；`Cargo.toml` 中也没有明确的 account vault dependency。`Cargo.lock` 的 transitive `security-framework` 不能作为 vault implementation evidence。
3. Design 已冻结 `accountConvenience`、`accountBrokerCore`、`accountGatewayReal` 等 logical flags 默认 off，并规定 `accountFrontendMock` / Account Lab 仅 compile-time DEV/test。Literal storage/build/env keys、per-platform flags、fixed token2api origin 与 build-channel config 仍待 executable task/security review；`VITE_DOGE_ACCOUNT_LAB=1` 仍只是 research proposal，不是当前 source 中的可执行 key。
4. 本机通过 `OPENSSL_DIR` 提供可用的 arm64 OpenSSL@3 dylibs，因此当前 ARM64 single-arch unsigned chain 不被 OpenSSL 阻断；但该 dependency 是 host-local、repo 未固定的输入，clean package shell 必须显式继承并验证。Homebrew 与默认 `/opt/homebrew/opt/openssl@3` fallback 均不可用。
5. 本机没有 code-signing identity、notary profile 或 Tauri updater signing env；现存 `.app` 的 `codesign --verify --deep --strict` 与 Gatekeeper assessment 均失败。Unsigned UI/Local Mode smoke 可做，但不能自动等价为 OS Keychain durable-session acceptance。
6. clean-room parity 未建立：CI 使用 Node 20；本机是 Node 24.15.0。Rust 使用 floating `stable`，仓库无 `rust-toolchain*` pin；本机当前为 Rust 1.97.1。现有 `node_modules` 另有 5 个 extraneous packages。

最新 `token2api-modification-verdict.md` 进一步确认：Mock、Local Mode、package skeleton 与窄只读 PoC 不要求先改 token2api；但本 change 的首个 bounded Real trial 明确包含 persistent desktop session、OAuth/reset、truthful logout/revoke 与 managed key/Codex configuration，所以不能采用该窄豁免。

因此交付顺序必须是：formal tasks → G1 executable account contracts → G2/G3 lane readiness → G4 conformance → G5 Late integration → clean worktree ARM64 package → G6 install/launch/Local Mode/Real journey smoke。Mock UI 完成不能跳过 Real package gates。

## 2. Current Toolchain And Environment

| Item | Current fact | Readiness implication |
|---|---|---|
| Host | macOS 26.5.2, `arm64` | 只承诺本机 ARM64 package；Windows/Linux 保留 matrix |
| Node / npm | Node `24.15.0`, npm `11.12.1` | 与 CI Node 20 不同；clean-room package 应切 Node 20 |
| Tauri CLI | `2.9.6` from `node_modules` | 与 lockfile 安装面一致 |
| Rust | `rustc/cargo 1.97.1`, `stable-aarch64-apple-darwin` | floating stable；必须记录 exact `rustc -Vv`，最好在试用包前 pin |
| Rust targets | 仅 `aarch64-apple-darwin` | ARM64 足够；x64/universal 需另装 target 与 x64 OpenSSL |
| CMake | `4.4.2`; `doctor --strict` pass | whisper/native dependency prerequisite 可用 |
| Apple tools | Command Line Tools / Apple clang 21；`xcodebuild` 不可用 | unsigned ARM64 历史链路可行；不等于完整 signed/notarized environment |
| OpenSSL | `OPENSSL_DIR` 已设置，其 `libssl.3.dylib` / `libcrypto.3.dylib` 均为 arm64；Homebrew/default prefix 不可用 | ARM64 single-arch prerequisite present；必须在 clean package shell复验，不能依赖隐式个人环境 |
| Signing | 0 valid code-signing identities；sign/notary env unset | unsigned only；Keychain/signature continuity residual |
| npm dependency tree | lockfile v3；5 extraneous packages | 当前 warm `node_modules` 不可作为 clean install evidence；使用 `npm ci` |
| Version facts | `config/brand.json`、`package.json`、lock root、Cargo、Tauri 均为 `0.1.0` | 一致；重复 build 会覆盖同名 local DMG，必须隔离 output/worktree |
| Updater | `createUpdaterArtifacts=false`, endpoints empty, pubkey empty | 本地 package可继续；signed release workflow按设计 fail closed |

仓库没有 `.node-version`、`.nvmrc`、`rust-toolchain*`，`package.json` 也没有 `engines` / `packageManager` version declaration。`preinstall` 会拒绝非 npm manager，但不会固定 Node/npm version。

## 3. Build And Package Lanes

### 3.1 Dev Mock / Account Lab

Mock lane 用于 frontend experience review。Formal design 将其交付物定义为 **M0 Account UI Mock Review Package**：它可以 locally runnable/packageable，但不是普通 production distribution，也不是 A0 integrated trial：

```bash
# 仅当实现阶段真正落盘该双 gate 后才可执行
VITE_DOGE_ACCOUNT_LAB=1 npm run dev
```

必须同时满足 `import.meta.env.DEV === true` 与 `VITE_DOGE_ACCOUNT_LAB === "1"`；使用 isolated Account Lab、Mock gateway 与 deterministic scenario runtime，且 zero token2api network / zero Tauri calls。

禁止产出“production Mock DMG”：

- production resolver 只允许 `off | real`；Mock/Lab/scenario catalog 必须从 production reachable graph 排除；
- URL、`localStorage` 或普通用户 env 不能打开 Mock success；
- Real failure 不能 fallback 到 Mock；
- M0 package 即使可启动，也只能报告 `UI accepted against Mock scenarios`，不满足 behavior spec 的 A0 本地试用 acceptance。

### 3.2 Integrated Local Trial Package

Feature/env contract：

Integrated package 必须满足：

- production composition root 注入 `RealAccountGatewayV1`；
- Account convenience flag 和子 capability flags 使用 formal design 冻结的 logical flags/defaults；literal storage/build/env key 必须由 executable contract 单一化；
- authority origin 来自 fixed signed/build-channel config，并且是 HTTPS；renderer、用户输入、Mock fixture、runtime arbitrary env 均不能提供 base URL；
- package 内不含 password、token、TOTP、ticket、API key、private URL query、real email 或 production fixture；
- `VITE_DOGE_ACCOUNT_LAB`、`VITE_ENABLE_REACT_SCAN`、`VITE_ENABLE_PERF_BASELINE` 在 package command 中显式 unset；
- `createUpdaterArtifacts=false` 保持不变，本地试用不得顺手开启 updater/release trust chain。

Formal design 已冻结 `accountConvenience`、`accountBrokerCore`、`accountGatewayReal`、`accountDesktopAuth`、`accountProfileSecurity`、`accountUsagePull`、`accountManagedKey`、`accountConfigOnboarding`、`accountRecipeCodexV1` 等 logical names，且 pre-integration 默认 off；但 exact literal storage/build/env keys、origin config location、channel selection 与 per-platform evidence flags 尚未冻结，所以不能给出诚实的最终 env assignment。Executable tasks 必须建立一份 secret-free build config contract，并增加 gate 证明：

1. Real/off 是唯一 production mode；
2. Mock/Lab module 不在 production graph/chunks；
3. authority origin 是 allowlisted fixed HTTPS value，且不来自 renderer/user config；
4. account flags off 时没有 account route、startup wait、background call 或 Local Core gate；
5. package metadata 能记录 build channel、contract versions 与 source commit，但不记录 secret/PII。

## 4. Executable Build Commands And Gate

以下是 implementation 完成后的 macOS ARM64 local-trial gate。当前任务不执行这些长命令。

### Gate A — Frozen source and clean environment

必须从 integrated commit 创建独立 clean worktree/clone；不要在当前 dirty shared worktree 打包。

```bash
git status --short
git rev-parse HEAD
node --version          # required lane: Node 20.x, match CI
npm --version
rustc --version --verbose
cargo --version
rustup target list --installed
cmake --version
```

Acceptance：

- `git status --short` 为空；source commit 已记录；
- Node 20 与 `package-lock.json` v3 配套；
- `aarch64-apple-darwin` target present；
- OpenSSL@3 prefix 与两份 dylib 存在；
- signed lane 额外存在指定 `CODESIGN_IDENTITY`；unsigned lane 明确标记为 internal/local-only。

Clean install：

```bash
npm ci
npm ls --depth=0
npm run doctor:strict
```

`npm ls --depth=0` 必须无 missing/invalid/extraneous。不要用当前 874 MB warm `node_modules` 作为 acceptance evidence。

### Gate B — Static and contract checks

最低 full gate：

```bash
npm run check:branding
npm run check:docs
npm run check:runtime-contracts
npm run check:messages-boundaries
npm run check:engine-capability-matrix
npm run check:bundle-chunking
npm run check:large-files
npm run lint
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
node --test scripts/build-platform.contract.test.mjs scripts/release-workflow.contract.test.mjs
openspec validate --change integrate-token2api-account-system --strict --no-interactive
git diff --check
```

Account implementation 必须再提供并运行正式 tasks 冻结的 focused gates。Research 建议名可作为方向，但不能在 scripts 落盘前假装存在：

```text
check:account-gateway-contract
test:account-ui-contract
check:account-scenario-fixtures
check:account-production-boundary
account Mock/Real/Broker/Authority conformance
Local Mode flags-off/outage/vault-unavailable regression
Real token2api integration/e2e
```

任何 Mock/Real drift、vault plaintext/session-only fallback、authority capability gap、production Mock reachability、raw secret/PII/path/diff scan finding 均为 package blocker。

### Gate C — Production frontend and Rust package preflight

```bash
env \
  -u VITE_DOGE_ACCOUNT_LAB \
  -u VITE_ENABLE_REACT_SCAN \
  -u VITE_ENABLE_PERF_BASELINE \
  npm run build

cargo test --manifest-path src-tauri/Cargo.toml --no-run
```

`npm run build` 必须完成 strict TypeScript + Vite production build。随后检查 production chunks 不含 Account Lab、Mock gateway、scenario catalog、real fixture secrets 或 React Scan。

### Gate D — ARM64 package

Unsigned internal trial：

```bash
env \
  -u VITE_DOGE_ACCOUNT_LAB \
  -u VITE_ENABLE_REACT_SCAN \
  -u VITE_ENABLE_PERF_BASELINE \
  npm run build:mac-arm64 -- --skip-sign --skip-notarize
```

Locally signed but not notarized trial（recommended for OS Keychain acceptance）：

```bash
CODESIGN_IDENTITY="<validated local or Developer ID identity>" \
env \
  -u VITE_DOGE_ACCOUNT_LAB \
  -u VITE_ENABLE_REACT_SCAN \
  -u VITE_ENABLE_PERF_BASELINE \
  npm run build:mac-arm64 -- --skip-notarize
```

不要把 placeholder identity 原样执行。签名 identity 必须先由 `security find-identity -v -p codesigning` 验证，并由 package owner 确认适合该试用范围。

`scripts/build-platform.mjs` 会：

1. 先执行 frontend build；
2. 精确删除目标 release fingerprint、旧 binary 与 bundle，再执行 Tauri app build；
3. 将 OpenSSL dylibs 复制进 `Contents/Frameworks` 并修正 `@rpath`；
4. signed lane 重签 app components；unsigned lane不签名；
5. 使用 `scripts/create-dmg.sh` 生成 DMG。

这些 cache/bundle 删除只允许发生在专用 package worktree。不要对共享 worktree 或整个 `src-tauri/target` 做 blind clean。

## 5. Prerequisites And Current Blockers

### P0 before any integrated package

- Formal `design.md` 已冻结 G0；`tasks.md` 必须把 `v1-contract-freeze-review.md` 的 B-01–B-12 resolution 和 G1–G6/A0 gates变成 executable ownership/commands。
- Canonical contract/schema/fixture/scenario assets已落盘，Mock、Real-over-scenario transport、Broker fake 与 token2api authority conformance通过。
- token2api release prerequisites通过：从 clean secure baseline 纳入 upstream OAuth account-takeover fix（M1）；关闭 durable auth/atomic refresh（M2）、MFA atomic consume/secret logging（M3）、durable revoke（M4）、truthful logout（M5）、managed API-key secret lifecycle（M6）与 ACL presence baseline（M7）；提供 stable guarantees/errors（M8）、generic Desktop OAuth/reset adapters（A1/A2）和 capability descriptor（A3）。M9 只在首包展示精确 subscription progress 时 blocking；M10 privacy logging按实际 exposure 完成收口。
- token2api release必须记录 exact deployed server commit/version/guarantee response；current checkout behind remote 或“route存在/HTTP 200”都不是 capability-ready evidence。
- doge Real substrate已通过：macOS vault、loopback/PKCE/state/nonce、account DB、session generation、fixed HTTPS client、config plan/apply/receipt/recovery、safe IPC 和 Local Mode startup isolation。
- production flag/origin/build-channel config 已冻结且有 negative bundle gates。

### Host OpenSSL guard

本机当前 `OPENSSL_DIR` 指向一个存在的 local OpenSSL@3 prefix；其两份 dylib 都是 arm64。`scripts/macos-fix-openssl.sh` 会优先使用这个变量，因此 ARM64 single-arch unsigned/local-sign chain 当前具备 OpenSSL prerequisite。

但 repo 没有固定该输入，`brew` 与 `/opt/homebrew/opt/openssl@3` fallback 也不可用。Clean worktree/package shell 必须先验证：

```bash
test -n "${OPENSSL_DIR:-}"
test -d "$OPENSSL_DIR"
file "$OPENSSL_DIR/lib/libssl.3.dylib"
file "$OPENSSL_DIR/lib/libcrypto.3.dylib"
```

两者必须存在且包含 `arm64`。不要把个人绝对路径写进 repo config；若 package shell 未继承 `OPENSSL_DIR`，应显式配置一个已审核 prefix，而不是把旧 build cache 当作成功证据。

### Reproducibility blockers / risks

- Node 24 host vs CI Node 20；trial lane应使用 Node 20。
- Rust `stable` 没有日期/version pin。最低要求记录 `rustc -Vv`；更可靠方案是引入并审查 `rust-toolchain.toml`，但这属于后续 authorized config change。
- `packageManager`/`engines` 未固定；依赖事实以 `package-lock.json` + `npm ci` 为准。
- 当前 `src-tauri/target` 约 29 GB，是 warm-cache state；clean package worktree必须从 empty target 开始跑一次，再在 warm cache 重跑关键 gates，确认语义一致。DMG 包含 timestamp/Finder metadata，不要求 byte-for-byte deterministic，但 bundle identity、arch、resources、library linkage、contract metadata 与 smoke outcome必须一致。
- `release-local/doge_0.1.0_aarch64.dmg` 已存在；当前 script 会覆盖同名输出。使用独立 worktree/output，并在 artifact name/checksum ledger 追加 commit SHA，避免混淆旧包。

## 6. Bundle Artifact Paths And Inspection

Expected outputs：

| Artifact | Path | Notes |
|---|---|---|
| Frontend dist | `dist/` | transient production assets；不是试用交付物 |
| ARM64 app | `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/doge.app` | primary bundle inspection target |
| App binary | `.../doge.app/Contents/MacOS/doge` | must be arm64 |
| Daemon binary | `.../doge.app/Contents/MacOS/doge_daemon` | must exist and be arm64 |
| Bundled OpenSSL | `.../doge.app/Contents/Frameworks/libssl.3.dylib`, `libcrypto.3.dylib` | arm64, `@rpath`, no host absolute path |
| Local DMG | `release-local/doge_0.1.0_aarch64.dmg` | ignored local artifact; add commit/checksum to handoff ledger |
| Raw Rust binaries | `src-tauri/target/aarch64-apple-darwin/release/{doge,doge_daemon}` | build evidence, not installer |

`tauri.conf.json` also bundles `infoplist`, agent catalogs, curated skills and `skills-lock.json`; `build.rs` validates curated-skill lock and agent catalog at compile time。Package smoke must inspect those resources rather than assuming compile success proves runtime lookup layout。

The desktop DMG does not itself replace the separate Web Service asset artifact contract. If Local Mode smoke includes packaged Web Service startup, the test setup must also provide a valid `doge-web-assets_0.1.0.zip` + `.sha256` through the managed install/import flow, or explicitly record `WEB_ASSETS_NOT_READY` as an unfulfilled prerequisite rather than an account regression。

## 7. Signing And Local Installation Implications

### Unsigned lane

- `--skip-sign --skip-notarize` is supported for internal/local validation only。
- OpenSSL is still bundled, but the post-fixup app is not validly signed. Current historical app returns non-zero for strict codesign and Gatekeeper checks。
- User may need Finder **Open** / System Settings → Privacy & Security → **Open Anyway**. Do not present this as a distributable package or advise disabling Gatekeeper globally。
- TCC/automation permissions and macOS Keychain access may bind to unstable/ad-hoc code requirements across rebuilds. Therefore an unsigned smoke can validate UI、Local Mode、network/error isolation，but durable vault restore/logout/reinstall acceptance needs explicit evidence under that exact signature state。

### Locally signed lane

- Preferred for the integrated account trial because OS vault is a hard product invariant。
- Requires a validated identity and `CODESIGN_IDENTITY`; run with `--skip-notarize` if the package remains local。
- `codesign --verify --deep --strict` must pass after OpenSSL fixup and before DMG creation/installation。
- A locally signed but non-notarized package may still be rejected by Gatekeeper on another Mac; do not expand distribution scope。

### Release-grade lane

Not required for this local trial and currently fail closed。It additionally needs doge-owned Developer ID certificate、notary credentials、Tauri updater signing keys、enabled updater public key/endpoints and successful release preflight。Do not reuse upstream signing material or publish partial `latest.json`。

## 8. Package Smoke Tests

### 8.1 Artifact inspection

After build, from the clean package worktree：

```bash
APP="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/doge.app"
DMG="release-local/doge_0.1.0_aarch64.dmg"

test -d "$APP"
test -x "$APP/Contents/MacOS/doge"
test -x "$APP/Contents/MacOS/doge_daemon"
test -f "$APP/Contents/Frameworks/libssl.3.dylib"
test -f "$APP/Contents/Frameworks/libcrypto.3.dylib"
file "$APP/Contents/MacOS/doge"
file "$APP/Contents/MacOS/doge_daemon"
file "$APP/Contents/Frameworks/libssl.3.dylib"
file "$APP/Contents/Frameworks/libcrypto.3.dylib"
otool -L "$APP/Contents/MacOS/doge"
otool -L "$APP/Contents/MacOS/doge_daemon"
plutil -p "$APP/Contents/Info.plist"
hdiutil verify "$DMG"
shasum -a 256 "$DMG"
```

Fail if any binary/dylib is wrong-arch, daemon/resources are absent, Info.plist identity/version drifts, or OpenSSL reference contains `/Users`、`/opt/homebrew` or `/usr/local` instead of `@rpath`。

Signed lane additionally：

```bash
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv --verbose=4 "$APP"
spctl --assess --type execute --verbose=4 "$APP"
```

For non-notarized local signing, record Gatekeeper result honestly; a codesign pass does not imply notarization/distribution readiness。

### 8.2 Install and launch matrix

Use a fresh macOS user profile or documented clean app-data namespace where practical。Record OS version、arch、commit、DMG SHA-256、signature state and token2api environment identity without recording credentials。

| Scenario | Blocking expectation |
|---|---|
| DMG mount/install/first launch | app copies/launches; identity `io.github.jasonmao-msj.doge`; no setup panic |
| Account flags off | no Account entry/module/network/startup wait; all existing Local Mode surfaces remain usable |
| Signed out | complete Local Mode; opening Account is opt-in and does not gate workspace/engine/file/Git/terminal |
| token2api DNS/TLS/5xx/offline | Account shows closed degraded state; Local Mode stays usable |
| vault locked/unavailable | no plaintext/session-only fallback; remain signed out; Local Mode stays usable |
| Real login + MFA/OAuth/verification as enabled | only negotiated capability shown; authenticated only after durable vault/metadata/me commit |
| Restart restore | signed session restores from OS vault; no token/PII appears in renderer/log/support artifacts |
| logout/session expiry/revoke | account state settles correctly; Local Mode remains complete |
| usage/quota | no startup/background fetch; only surface open/manual refresh reads; stale is not reported as zero |
| Codex plan/apply | three consents preserved; exact plan、receipt/recovery、restart behavior pass; no raw path/diff/secret crosses IPC |
| Mock production isolation | package cannot open Lab/select Mock via URL、env or `localStorage`; chunks contain no Mock scenario catalog |
| Existing Web Service, if in acceptance scope | managed web-assets prerequisite met and service starts; otherwise explicit prerequisite failure recorded |

Real token2api smoke must use dedicated synthetic test accounts and a non-production authority environment。Passwords、MFA codes、refresh tokens、API keys and callback tickets must never be pasted into test report、shell history、screenshots or committed fixtures。

## 9. Dirty-Worktree And Artifact Protection

The current shared worktree is not package-safe：it contains multiple modified/untracked governance、agent-system and token2api change artifacts from concurrent work。A package built here would have ambiguous provenance and could silently include uncommitted source。

Required protections：

1. Package only an integrated commit from a separate clean worktree/clone；do not stash、reset、clean or revert this shared worktree。
2. Before install/build, save `git rev-parse HEAD` and require empty `git status --short`。
3. Use `npm ci`; never repair the lockfile during package gate。
4. Keep package output in that worktree's ignored `release-local/`; do not overwrite the historical DMGs in this worktree。
5. Record `{commit, version, host arch, tool versions, signature state, artifact path, size, SHA-256}` in Release Evidence。
6. After build, require `git status --short` still empty except explicitly ignored build outputs；any tracked diff is a blocker。
7. Never run whole-cache deletion、lockfile reset or destructive Git cleanup to make the build green。`build-platform.mjs` 的 targeted release-cache deletion只可在专用 build worktree发生。

## 10. Cross-Platform Residual Matrix

| Platform | This task status | Required later evidence |
|---|---|---|
| macOS ARM64 | host preflight complete；integrated package blocked | clean build、signed/unsigned decision、vault/loopback/config Real E2E、install/launch/Local Mode smoke |
| macOS x64/universal | not required for first host trial | x64 target + `/tmp/openssl-x86_64`、Intel runner/device、same smoke matrix |
| Windows x64 | no local build required；historical unsigned NSIS artifact only | Credential Manager、browser callback、config replace、install/launch Real smoke；artifact-only workflow remains non-release |
| Linux x64/arm64 | no local build required | Secret Service/headless policy、browser callback、filesystem/appimage smoke；unverified capability stays disabled |

## 11. Package Acceptance Checklist

### Contract and implementation

- [x] Formal design freezes G0 architecture、logical flags and M0/A0 verdict。
- [ ] Formal tasks instantiate all v1 freeze resolutions and G1–G6 executable gates。
- [ ] Mock/Real/Broker/Authority shared conformance is green。
- [ ] Real token2api prerequisites and macOS Broker/vault/config substrate are green。
- [ ] Production account flags、fixed HTTPS origin and channel config are frozen and secret-free。
- [ ] Mock/Lab/scenario runtime is absent from production graph and cannot be selected at runtime。

### Build and artifact

- [ ] Dedicated clean worktree at recorded integrated commit。
- [ ] Node 20 + `npm ci`; dependency tree clean。
- [ ] Exact Rust/toolchain、CMake、Tauri and OpenSSL facts recorded。
- [ ] Full static/test/account gates pass without weakening existing protections。
- [ ] ARM64 app/daemon/OpenSSL/resources/Info.plist inspection passes。
- [ ] DMG verify、size、SHA-256 and provenance ledger complete。
- [ ] Signature lane explicitly selected; unsigned limitations or signed identity evidence recorded。

### Runtime acceptance

- [ ] DMG install and first/cold/restart launch pass on target Mac。
- [ ] Account flags-off and signed-out Local Mode regressions pass。
- [ ] Vault unavailable、offline/outage、session expiry、quota exhausted do not gate Local Mode。
- [ ] Real auth/session restore/logout and negotiated capability journeys pass。
- [ ] Pull-only usage behavior passes with zero proactive startup/background reads。
- [ ] Codex plan/apply/recovery and exact consent sequence pass。
- [ ] Logs、renderer、SQLite、support bundle and fixtures contain no forbidden secret/PII/raw path/diff。
- [ ] User experience acceptance explicitly says `Real integrated package`, not only `Mock UI accepted`。

## 12. Handoff Summary

The existing doge ARM64 package path is usable while its current host prerequisites are explicitly preserved and verified, but it must be treated as a post-integration gate, not as proof that the account feature is ready。The immediate build/CI actions for downstream owners are：

1. formalize production account mode/origin/channel config and package-boundary tests；
2. add executable conformance and Real integration gates before any package command；
3. preserve and validate the arm64 `OPENSSL_DIR` input，and align local Node with CI Node 20；
4. choose unsigned UI smoke or a stable local signing identity，with locally signed package preferred for OS Keychain acceptance；
5. build only from a clean integrated commit and hand off checksum + smoke evidence。

No source/config/build/sign/release mutation was performed during this preflight。
