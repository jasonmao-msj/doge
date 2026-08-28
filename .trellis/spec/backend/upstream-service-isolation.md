# Upstream Service and Release Isolation Contract

## Scenario: upstream is developer provenance, never a runtime dependency

### 1. Scope / Trigger

- Trigger: upstream sync、analytics、managed provider default、About/Issue/Release URL、updater key/endpoint、release workflow or signing helper changes。
- 目标：App shipping surface 不连接、不信任、不展示上游；developer-only Git fetch topology 可保留；正式发布在 doge trust chain 不完整时 fail closed。

### 2. Signatures

- Developer audit：`auditRemoteTopology(topology) -> string[]`。
- Canonical upstream fetch URL only in `scripts/upstream-sync-audit.mjs`；`remote.upstream.pushurl=DISABLED`。
- Updater state：`bundle.createUpdaterArtifacts=false` and no updater plugin until doge key exists。
- Release preflight inputs：`TAURI_SIGNING_PRIVATE_KEY_B64`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` plus enabled updater config/public key/canonical endpoint。
- Release changelog commands：`npm run release:check`；`node scripts/check-release-changelog.mjs --extract-current <output>`。
- Release tag collision probe：`git ls-remote --tags origin "refs/tags/v${VERSION}"`，network failure 与 non-empty exact-ref result 都 MUST fail closed。
- Windows batched test recovery：`VITEST_RETRY`（integer `0..3`）→ `parseVitestBatchConfig(...).retry` → Vitest `--retry <n>`；default `0`，shipping `test-windows` lane固定 `1`。
- Internal artifact inputs：`workflow_dispatch.inputs.windows_artifact_only: boolean` 与 `workflow_dispatch.inputs.macos_artifact_only: boolean`；true 时只允许对应平台的 unsigned installer artifact build。
- Default manual packaging：上述两个 input MUST both default to `true`，因此未改参数的 `workflow_dispatch` MUST 在同一个 workflow run 内并行产出 macOS 与 Windows internal artifacts。Agent MUST prefer this combined default；只有用户明确要求单平台，或某个平台失败后做 targeted retry，才 MAY 把另一平台 input 设为 `false`。正式 signed release MUST 显式把两个 input 都设为 `false`，并继续通过 release preflight。
- External provider contract：user-supplied custom base URL remains supported；no upstream managed relay default。

### 3. Contracts

- Shipping source MUST NOT contain upstream repository/release endpoint、analytics host/site id、managed relay default、upstream signing key or Apple identity。
- Removed analytics modules/commands/state/CSP permissions MUST stay absent across frontend、Rust、command registry and all windows/modes。
- Generic user-configured provider URL MUST remain available; removal targets only upstream-owned preset/default。
- About、Settings、Error、update metadata and web-assets URL MUST point to canonical doge repository/release or local-only fallback。
- Upstream remote is fetch-only developer topology。Audit MUST read local Git config only; MUST NOT fetch、push or mutate。
- Release workflow MUST stop before matrix build when signing secrets or enabled doge updater trust chain are incomplete；MUST NOT publish partial `latest.json`。
- Signed Release MUST stop before matrix build unless `GITHUB_REF=refs/heads/main`；artifact-only internal builds MAY run from an explicitly selected non-main ref。
- Signed Release MUST stop before matrix build when exact `refs/tags/v<canonical-version>` lookup fails or already exists；workflow MUST NOT delete、move或 reuse冲突 tag。
- Shipping Release MUST stop before matrix build unless the committed first `CHANGELOG.md` entry matches all canonical versions and contains non-empty 中文/English bodies。该 entry MUST 同时生成 `latest.json.notes` 与 GitHub Release body；workflow MUST NOT scan Git history生成第二份 notes、修改 version/changelog 或创建 post-release PR。
- Release workflow 默认权限 MUST 为 `contents: read`；只有最终 publish job MAY 提升为 `contents: write`，workflow MUST NOT 请求 `pull-requests: write`。
- Windows CI MAY为 transient runner scheduling对 failed test做一次 Vitest retry；MUST保留默认 5000ms test timeout，MUST NOT让非 Windows/default callers继承 retry，且 retry MUST bounded `<=3`。
- `windows_artifact_only=true` MAY bypass release preflight only for an internal test installer job；该 job MUST use `contents: read`、MUST NOT reference release environment/secrets、MUST NOT generate `.sig`/`latest.json` or call `gh release`，且只能上传 NSIS EXE + SHA-256 Actions artifact。
- `macos_artifact_only=true` MAY bypass release preflight only for internal Apple Silicon / Intel test DMG jobs；jobs MUST use `contents: read`、MUST NOT reference release environment/secrets、MUST use explicit `--skip-sign --skip-notarize`、MUST verify each DMG with `hdiutil verify`，且只能上传 DMG + SHA-256 Actions artifacts。
- Credential helper MUST NOT export、encode、persist or print password/private key/certificate content。

### 4. Validation & Error Matrix

| 状态 | 必须行为 | 禁止行为 |
|---|---|---|
| upstream fetch URL canonical + push disabled | audit pass | expose URL in App links |
| upstream push enabled/wrong URL | audit fail | auto-repair silently |
| updater disabled/no key | release preflight fail before builds | publish unsigned metadata |
| `windows_artifact_only=true` | Windows runner builds unsigned NSIS and uploads EXE/checksum artifact | access secrets、publish Release/update feed、silently treat as signed release |
| `macos_artifact_only=true` | macOS ARM64 / Intel runners build unsigned DMGs and upload DMG/checksum artifacts | access secrets、sign/notarize、publish Release/update feed、silently treat as signed release |
| manual dispatch accepts defaults | one run builds macOS ARM64 / Intel DMGs and Windows x64 NSIS in parallel | split routine packaging into separate runs、enter signed release lane |
| explicit single-platform retry | only the requested/retried artifact job runs | silently treat platform-only output as the default complete set |
| both artifact inputs explicitly `false` | enter signed release preflight | bypass trust-chain validation or publish unsigned metadata |
| signed release selected ref is not `main` | preflight fail before platform matrix | publish unreviewed branch |
| exact release tag lookup fails | preflight fail before platform matrix | 把 network error当作 tag absent |
| exact release tag already exists | report conflict and fail before platform matrix | move/delete/reuse tag |
| signed release + stale/missing CHANGELOG | preflight fail before platform matrix | runner 临时生成 notes 或继续发布 |
| committed current CHANGELOG valid | extract exact bilingual current entry for updater + GitHub Release | commit scan body 与 App 版本记录漂移 |
| release workflow permissions | default `contents: read`；final publish job only `contents: write` | workflow-wide write 或 `pull-requests: write` |
| default/macOS batched Vitest | `retry=0` | 隐式放宽所有 CI callers |
| Windows batched transient timeout | Vitest retry failed test once | rerun entire 40min job或全局增大 timeout |
| deterministic Windows test hang | second attempt仍在原 timeout失败 | unbounded retry掩盖缺陷 |
| some platform signature missing | metadata job fail | omit platform and publish partial feed |
| custom provider URL | accept through generic path | replace with removed relay |
| removed analytics token returns in shipping source | exact negative test fail | allowlist runtime service |

### 5. Good / Base / Bad Cases

- Good：developers fetch upstream into a sync branch, perform semantic merge, then pass doge isolation gates。
- Good：developer manually dispatches `windows_artifact_only=true` to obtain an explicitly unsigned internal Windows installer without weakening the signed release lane。
- Good：developer manually dispatches `macos_artifact_only=true` to obtain checksummed Apple Silicon and Intel test DMGs without weakening the signed release lane。
- Good：routine internal packaging keeps both default inputs enabled and obtains Mac + Windows artifacts from one traceable workflow run。
- Good：candidate version exact tag不存在，signed preflight确认 remote lookup成功且 output为空后才启动 platform matrix。
- Good：Windows runner单次 5s jitter由 `--retry 1` 恢复；同一测试连续失败两次仍阻断 CI。
- Base：single-platform mode is an explicit operator choice for targeted retry or a user-requested platform-only package。
- Base：normal client distribution uses GitHub Releases and needs no custom cloud server。
- Bad：agent routinely starts separate Mac and Windows runs even though the combined default is available。
- Bad：只因为 GitHub Release不存在就复用同名 legacy tag，或把 remote lookup failure当作 tag absent。
- Bad：把所有 test timeout从 5s提高到 15s，或对本地/macOS默认开启 retry。
- Bad：reuse upstream updater public key、Apple identity、analytics endpoint or managed relay。

### 6. Tests Required

- `npx vitest run src/features/brand/contracts/upstreamServiceIsolation.test.ts src/features/brand/contracts/externalServiceContracts.test.ts src/features/brand/contracts/productLinks.test.tsx`
- `node --test scripts/upstream-sync-audit.test.mjs scripts/release-workflow.contract.test.mjs`；release contract MUST assert both artifact inputs default to `true`、combined dispatch reaches both platform jobs、artifact-only jobs have read-only permissions and no secret/signature/publish surface。
- `npm run check:upstream-sync && npm run check:branding && npm run check:docs`
- `npm run release:check && npm run release:check:test && node --test scripts/release-workflow.contract.test.mjs`
- Contract test MUST assert exact-ref remote lookup、lookup error fail-closed、non-empty collision fail-closed，以及无 tag mutation command。
- `node --test scripts/test-batched.test.mjs` MUST assert default/Windows retry config、invalid/out-of-range rejection 与 exact Vitest args；CI static contract MUST assert only `test-windows` sets `VITEST_RETRY: "1"`。
- Release/draft smoke remains manual until doge-owned signing material exists。

### 7. Wrong vs Correct

#### Wrong

```yaml
- run: generate-latest-json-even-when-signatures-are-missing
```

#### Correct

```yaml
- name: Verify doge updater trust chain
  run: test -n "$TAURI_SIGNING_PRIVATE_KEY_B64" && verify_updater_config
```

#### Wrong

```yaml
- name: Generate release notes from commits and bump after publish
  run: git log "$LAST_TAG..HEAD" > release-notes.md && gh pr create
```

#### Correct

```yaml
- name: Verify committed release changelog
  run: npm run release:check

- name: Extract the reviewed current entry
  run: node scripts/check-release-changelog.mjs --extract-current release-artifacts/release-notes.md
```

#### Wrong

```bash
gh release create "v${VERSION}" --target "$GITHUB_SHA" # existing tag may still point elsewhere
```

#### Correct

```bash
TAG_LOOKUP=$(git ls-remote --tags origin "refs/tags/v${VERSION}") || exit 1
test -z "$TAG_LOOKUP" || exit 1
```
