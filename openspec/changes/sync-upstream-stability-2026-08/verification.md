# Verification Evidence

## Verification Level

- Level: **L3 cross-layer**
- Highest-risk triggers:
  - normalized realtime terminal ordering + durable assistant text
  - provider-scoped Codex launch/catalog/usage facts
  - Windows native WebView2 hook + binary stack reserve
  - Git index/worktree mutation semantics
  - release/build artifact fail-closed behavior
- Bounded impact surface: selected files listed in `upstream-capability-matrix.md`; no DB schema/migration, no Product Account API change, no engine registry/Shared allowlist change, no version/Release mutation.

## Automated Results

### Frontend focused behavior

Passed:

```bash
npx vitest run \
  src/features/threads/contracts/realtimeEventContract.test.ts \
  src/features/threads/hooks/useThreadItemEvents.terminalTextCommit.test.ts \
  src/features/app/hooks/useAppServerEvents.tokenUsage.test.tsx \
  src/features/models/atomicModelReasoning.test.ts \
  src/app-shell-parts/modelSelection.test.ts \
  src/features/composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners.test.tsx \
  src/utils/windowsReloadShortcutGuard.test.ts \
  src/utils/remarkFileLinks.test.ts \
  src/markdown/presentation/markdownLocalResources.test.ts \
  src/markdown/components/Markdown.file-links.test.tsx \
  src/features/messages/hooks/useFileLinkOpener.test.tsx \
  src/utils/boundToolOutput.test.ts \
  src/utils/threadItems.test.ts \
  src/features/threads/hooks/useThreadsReducer.test.ts \
  src/conversation-presentation/realtimePerfFlags.test.ts
```

Result: **15 files / 335 tests passed**.

### Rust focused behavior

Passed:

```bash
cargo test --manifest-path src-tauri/Cargo.toml usage_event_ --lib
# 3 passed

cargo test --manifest-path src-tauri/Cargo.toml provider_catalog_ --lib
# 4 passed (includes Shared missing-provider projection sibling)

cargo test --manifest-path src-tauri/Cargo.toml codex::provider_env::tests --lib
# 4 passed

cargo test --manifest-path src-tauri/Cargo.toml windows_f5_reload_guard --lib
# 1 passed

cargo test --manifest-path src-tauri/Cargo.toml unstaged_restore_ --lib
# 2 passed
```

Result: **14 focused Rust tests passed**. Existing repository warnings remain unchanged/non-blocking.

### Compile, lint, contracts and governance

Passed:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --bins
npm run typecheck
git diff --name-only -- '*.ts' '*.tsx' | tr '\n' '\0' | xargs -0 npx eslint
rustfmt --edition 2021 --check \
  src-tauri/build.rs \
  src-tauri/src/backend/app_server.rs \
  src-tauri/src/bin/doge_daemon/git.rs \
  src-tauri/src/codex/provider_env.rs \
  src-tauri/src/codex/session_runtime.rs \
  src-tauri/src/engine/codex_adapter.rs \
  src-tauri/src/engine/status.rs \
  src-tauri/src/git/commands.rs \
  src-tauri/src/git_utils.rs \
  src-tauri/src/shared/settings_core.rs \
  src-tauri/src/windows_f5_reload_guard.rs
node --test scripts/build-platform.contract.test.mjs
npm run check:runtime-contracts
npm run check:messages-boundaries
npm run check:realtime-event-batching
npm run check:model-provider-catalog
npm run check:branding
npm run check:upstream-sync
npm run check:docs
git diff --check
```

Notable results:

- Messages boundary: `inbound=0`, `new=0`.
- Runtime/event/model/branding/upstream/docs gates passed.
- Build-platform contract: **8 tests passed**.
- Native desktop + `doge_daemon` bins compile on the local macOS host.

### OpenSpec

Passed:

```bash
openspec validate sync-upstream-stability-2026-08 --type change --strict --no-interactive
```

Workspace audit:

```bash
openspec validate --all --strict --no-interactive --concurrency 8
```

Result: current change passed; workspace totals **529 passed / 4 failed**. All four failures pre-existed and are outside this change:

- `add-sub2api-relay-quota`
- `fix-ui-scale-native-zoom-freeze-all-platforms`
- `fix-windows-cold-start-freeze-residual`
- `retire-canvas-subagent-squad-grid`

## Cross-Layer Review Results

### Dimension A — data flow

- terminal: normalized batcher → synchronous terminal flush → reducer → terminal barrier; late exact assistant completion is content-only salvage and cannot mutate processing.
- Codex usage: Rust `Option<i64>` → app-server event → frontend `null`; no guessed denominator.
- provider catalog: provider config/discovery → scoped models → fill-only reasoning metadata; Product endpoint-protocol catalog remains separate.
- provider env: config `env_key` → Rust-only validated/bounded login-shell resolver → child env; `launch_env` values take precedence and secrets are not logged/persisted/rendered.
- Git discard: desktop/daemon → shared neutral restore args → index-to-worktree restore; staged content preserved.
- tool output: live dispatch gate remains scheduling owner; neutral retained-output helper bounds reducer and history normalization.

### Dimension B — reuse

- `boundToolOutput` moved to neutral `src/utils/` because it is consumed by both reducer and history normalization; no new feature-private dependency edge.
- Git restore argument shape is shared from `git_utils.rs` by desktop and daemon.
- reasoning source classification is shared by Atomic and AppShell model projection.

### Dimension C — imports/new files

- targeted ESLint/typecheck passed; Messages boundary stayed `new=0`.
- Windows WebView module is `cfg(any(test, target_os = "windows"))`; native install is only called for the main window.

### Dimension D — sibling consistency

- provider/model changes preserve `modelCatalogEntryId != runtime model` and do not alter Product target authority.
- `restore --staged --worktree -- .` remains only in explicit revert-all paths; single/batch unstaged discard uses `--worktree` only.
- the upstream PowerShell/`where` and `process_is_alive` sites do not exist in current doge, so no parallel owner was introduced.

## Known External / Pre-existing Gates

- `npm run check:engine-controller-facade` fails on untouched `src/features/engine/hooks/useEngineController.ts` (743 source lines vs 600 threshold); `origin/main` has the same line count and this branch does not modify the file.
- `npm run check:large-files` report mode lists existing repository debt (102 entries); new files in this change remain below the new-file threshold. Several touched legacy owners were already above policy before this change.
- Repository-local OpenSpec consistency wrapper cannot run because its required global script is absent at `~/.claude/skills/osp-openspec-sync/scripts/validate-consistency.py`; native OpenSpec strict validation was used instead.
- Full `check:heavy-test-noise --run` is an L4-sized 285-batch suite. It was stopped after 11 successful batches; the focused L3 suites above are the authoritative local evidence.

## Platform Evidence Levels / L4 Gaps

| Surface | Evidence | Level |
|---|---|---|
| macOS host Rust/TS behavior | focused tests + desktop/daemon compile | verified locally |
| Windows pure F5 key classification | TS + cfg(test) Rust tests | verified locally |
| Windows WebView2 COM hook / `/STACK:8388608` | source contract + dependency alignment; cross-target attempt stopped in `ring` C compilation because this macOS host lacks Windows CRT/SDK headers (`assert.h`) | **not runtime-verified**; Windows CI required |
| Windows Markdown/Git semantics | pure/frontend + Git fixture tests on macOS | logic verified; Windows filesystem/UI smoke pending |
| Windows mapped/network drive | intentionally deferred; no blanket canonicalize fallback | not implemented |
| Linux notification/runtime | unchanged | not retested |
| installer/signing/updater artifacts | build contract only | L4 Release/CI |
| real long Codex/Claude/Kimi conversations | unit/contract only | manual/L4 smoke pending |

## Rejected/Deferred Safety Evidence

- No frontend 90-second orphan timer was imported; doge continues to require typed/scoped terminal authority.
- No Claude full-turn idle hard kill was imported.
- No `canonicalize_or_original` fallback was added to external absolute read/write/delete boundaries.
- No PI/DSH/Qoder/wallpaper/upstream brand/release product surface was introduced.
