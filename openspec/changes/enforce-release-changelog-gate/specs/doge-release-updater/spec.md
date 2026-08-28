## ADDED Requirements

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

#### Scenario: Windows CI has transient per-test scheduling jitter

- **WHEN** the Windows batched Vitest lane encounters a single test timeout
- **THEN** it MAY retry that failed test exactly once using Vitest retry semantics
- **AND** the default and non-Windows callers MUST keep retry disabled
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
