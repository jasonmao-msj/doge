# doge-release-updater Specification

## Purpose
定义 doge desktop updater 的 canonical release feed、签名信任链、platform artifact 与 fail-closed release contract。
## Requirements
### Requirement: Shipping builds MUST use the doge signed update feed

Production desktop builds MUST enable Tauri updater artifacts and the updater plugin with the canonical doge release endpoint and the configured doge public key. The private signing key MUST remain outside the repository.

#### Scenario: valid shipping configuration

- **WHEN** a production Tauri configuration is inspected
- **THEN** updater artifacts are enabled for the base and Windows configurations
- **AND** the updater plugin is active
- **AND** its endpoint is `https://github.com/jasonmao-msj/doge/releases/latest/download/latest.json`
- **AND** its public key is the doge public key supplied for this change

#### Scenario: legacy trust source is rejected

- **WHEN** branding or release configuration is validated
- **THEN** the old `ccgui` repository, endpoint, or public key MUST NOT be used

### Requirement: Release publication MUST be fail-closed on trust-chain errors

The release workflow MUST validate signing secrets, updater activation, endpoint, public key, and required platform signatures before publishing `latest.json` or a GitHub release.

#### Scenario: missing signing secret

- **WHEN** a publishing workflow lacks `TAURI_SIGNING_PRIVATE_KEY_B64` or its password
- **THEN** preflight fails before release publication

#### Scenario: missing platform signature

- **WHEN** a Windows or macOS updater artifact has no matching `.sig`
- **THEN** the release job fails and does not publish an incomplete update manifest

### Requirement: Windows and macOS artifacts MUST match manifest platform entries

The generated `latest.json` MUST reference signed macOS `app.tar.gz` artifacts for both supported macOS architectures and a signed Windows NSIS installer for `windows-x86_64`, with URLs under the doge GitHub release.

#### Scenario: complete platform manifest

- **WHEN** the release job assembles `latest.json`
- **THEN** `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64` entries contain release URLs and non-empty signatures
- **AND** the manifest version matches the Tauri application version

### Requirement: Committed CHANGELOG MUST Be The Release Notes Authority

Every shipping release MUST use the current version entry committed in `CHANGELOG.md` as the sole content source for
the bundled App release-notes surface, `latest.json.notes`, and the GitHub Release body. The workflow MUST NOT derive a
second release body from Git history or mutate version/changelog files after publication.

#### Scenario: AI prepares a release

- **WHEN** AI is asked to publish a new doge version
- **THEN** the release preparation PR MUST update all canonical version files and prepend/replace the matching
  bilingual CHANGELOG entry
- **AND** the entry MUST summarize only user-facing changes since the nearest reachable doge release tag
- **AND** ordinary feature developers MUST NOT need to maintain release notes

#### Scenario: current CHANGELOG is valid

- **WHEN** CI or the signed release preflight validates the repository
- **THEN** six canonical versions MUST be equal
- **AND** the first CHANGELOG entry MUST match that version
- **AND** Chinese and English bodies MUST be non-empty
- **AND** history versions MUST be unique and descending

#### Scenario: release preparation was omitted

- **WHEN** App version changed without a matching valid CHANGELOG entry
- **THEN** normal CI MUST fail
- **AND** the signed release workflow MUST fail before any platform build starts
- **AND** no skip input MAY bypass this check

#### Scenario: signed release is dispatched from an unreviewed ref

- **WHEN** both artifact-only inputs are false and `GITHUB_REF` is not `refs/heads/main`
- **THEN** the signed release preflight MUST fail before any platform build starts
- **AND** artifact-only internal builds MAY still run from the selected ref

#### Scenario: canonical release tag is already occupied

- **WHEN** both artifact-only inputs are false and `refs/tags/v<canonical-version>` already exists on `origin`
- **THEN** the signed release preflight MUST fail before any platform build starts
- **AND** the workflow MUST report the conflicting exact tag
- **AND** MUST NOT move, delete, or reuse the existing tag

#### Scenario: canonical release tag cannot be verified

- **WHEN** the exact remote tag lookup exits non-zero because `origin` is unavailable or authentication fails
- **THEN** the signed release preflight MUST fail before any platform build starts
- **AND** MUST NOT treat the lookup error as proof that the tag is unused

#### Scenario: batched CI has transient per-test scheduling jitter

- **WHEN** a full batched Vitest CI lane encounters a single test timeout
- **THEN** it MAY retry that failed test exactly once using Vitest retry semantics
- **AND** local and default callers MUST keep retry disabled
- **AND** the per-test timeout MUST remain unchanged so a deterministic hang still fails after the bounded retry

#### Scenario: workflow publishes release metadata

- **WHEN** all signed platform artifacts succeed
- **THEN** workflow MUST extract the committed current CHANGELOG entry
- **AND** the exact extracted body MUST populate both `latest.json.notes` and `gh release create --notes-file`
- **AND** workflow MUST NOT scan global version-sorted tags or create a post-release version PR
- **AND** only the final publishing job MAY receive `contents: write`, and the workflow MUST NOT request
  `pull-requests: write`

#### Scenario: App is offline

- **WHEN** the user opens Version History without GitHub connectivity
- **THEN** the App MUST render the committed CHANGELOG bundled in the installed application
- **AND** MUST NOT require GitHub Releases API or any remote notes request
