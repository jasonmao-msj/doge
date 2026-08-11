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
| some platform signature missing | metadata job fail | omit platform and publish partial feed |
| custom provider URL | accept through generic path | replace with removed relay |
| removed analytics token returns in shipping source | exact negative test fail | allowlist runtime service |

### 5. Good / Base / Bad Cases

- Good：developers fetch upstream into a sync branch, perform semantic merge, then pass doge isolation gates。
- Good：developer manually dispatches `windows_artifact_only=true` to obtain an explicitly unsigned internal Windows installer without weakening the signed release lane。
- Good：developer manually dispatches `macos_artifact_only=true` to obtain checksummed Apple Silicon and Intel test DMGs without weakening the signed release lane。
- Good：routine internal packaging keeps both default inputs enabled and obtains Mac + Windows artifacts from one traceable workflow run。
- Base：single-platform mode is an explicit operator choice for targeted retry or a user-requested platform-only package。
- Base：normal client distribution uses GitHub Releases and needs no custom cloud server。
- Bad：agent routinely starts separate Mac and Windows runs even though the combined default is available。
- Bad：reuse upstream updater public key、Apple identity、analytics endpoint or managed relay。

### 6. Tests Required

- `npx vitest run src/features/brand/contracts/upstreamServiceIsolation.test.ts src/features/brand/contracts/externalServiceContracts.test.ts src/features/brand/contracts/productLinks.test.tsx`
- `node --test scripts/upstream-sync-audit.test.mjs scripts/release-workflow.contract.test.mjs`；release contract MUST assert both artifact inputs default to `true`、combined dispatch reaches both platform jobs、artifact-only jobs have read-only permissions and no secret/signature/publish surface。
- `npm run check:upstream-sync && npm run check:branding && npm run check:docs`
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
