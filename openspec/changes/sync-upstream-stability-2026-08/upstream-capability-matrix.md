# Upstream Capability Matrix

## Audit Baseline

- Fork merge-base: `2da6da39831a33cf31ea7f0c6796c66348e3a0c4`（2026-08-10）
- doge baseline: `origin/main@e0cad68d81c857058034aba5e1f068f78f3e8d77`
- upstream baseline: `upstream/main@cd362f8cf0190f459e7cf0628edf01367fa64552`
- Divergence: doge ahead `251` / upstream ahead `476`；upstream non-merge implementation commits `429`
- Decision vocabulary:
  - `adopt`: upstream solution can be ported with the same behavior contract.
  - `adapt`: root-cause fix is valuable, but doge ownership/branding/security requires a semantic rewrite.
  - `already-covered`: doge already has an equal or stronger product contract.
  - `defer`: valuable, but depends on a larger upstream architecture not accepted in this change.
  - `reject`: outside doge product boundary or conflicts with an explicit doge decision.

## Capability Decisions

| Upstream domain / evidence | Decision | doge reasoning | Apply target / evidence |
|---|---|---|---|
| Terminal final text causal drain + late final salvage (`0d8f2426c`) | **adopt** | doge already externalizes live text, but `flushPendingRealtimeEvents()` still omits the contract batcher and terminal guards drop a late full snapshot. This is the same root cause. | `realtimeEventContract` + `useThreadItemEvents` + `useThreadEventHandlers`; focused terminal tests |
| Codex usage must not invent 200K context (`41222cc2a`) | **adopt** | Exact provider facts align with doge Product/Provider identity; unknown must remain unknown. | `codex_adapter.rs` + `useAppServerEvents` tests |
| Codex managed catalog must not append official ghost rows (`0f90c742b`) | **adapt** | Correct for legacy/managed provider catalog; Product catalog remains governed by endpoint protocol projection and must not be replaced. | `engine/status.rs`; preserve `doge-token-matrix` Product target catalog |
| Codex runtime reasoning metadata (`2eefc6724`, `474fe8159`) | **adapt** | Valuable for non-Product and Product provider-owned rows, but must preserve `modelCatalogEntryId != runtime model` and endpoint-protocol authority. | provider target catalog owner + model selection helpers |
| macOS GUI/daemon Codex `env_key` resolution (`6c9c9cfc1`, `b4dcd1538`) | **adapt** | Custom managed profiles may depend on environment variables; doge secrets still come from native authority and must not be logged or copied to renderer. | new `codex/provider_env.rs`, desktop + `doge_daemon` wiring |
| Windows main-thread stack reserve (`637ba9a5a`) | **adapt** | Root fix is valid; binary linker target must be `doge`, not upstream `cc-gui`. | `src-tauri/build.rs` |
| Box deep async futures (`a561424a1`, Box-only hunks) | **adapt** | Reduces Windows stack pressure without importing unrelated AskUserQuestion changes bundled in the same upstream commit. | Codex spawn/ensure, engine detect, restart call boundaries |
| Windows background commands without console flash (`4fac18094`) | **already-covered / obsolete path** | doge's current open-app path already uses application/Tauri owners and `std_command`; the upstream PowerShell/`where` probe sites no longer exist in the fork. | `rg 'powershell|command_resolvable_on_path' src-tauri/src/workspaces/commands.rs` = no production hits |
| Windows F5 main-window reload guard (`add5ba06c`) | **adapt** | Web key guard is necessary but not sufficient; native guard is Windows-only, non-blocking, and must not create a startup lock. | frontend key guard + Windows message hook + failure-safe diagnostics |
| Windows `process_is_alive` cfg split (`7b552c6cb`) | **not-applicable upstream architecture** | doge no longer contains this workspace helper; importing it would add an unused parallel liveness owner. Current runtime owners retain their own platform process-tree contracts. | `rg 'process_is_alive' src-tauri/src` = no hits |
| Windows Markdown drive/UNC file links (`0004b75b4`) | **adapt** | User-visible and engine-neutral. Port parsing/opening semantics into doge's current Markdown pipeline; do not import upstream presentation refactors. | remark parser, local-resource normalizer, file-link opener |
| Network/mapped-drive canonicalize fallback (`0e9ee549b`) | **defer** | Upstream blanket fallback also touches external absolute paths and write/delete boundaries; lexical prefix checks are weaker than canonical containment. Requires a dedicated reparse/symlink threat model and Windows fixture. | keep as follow-up; do not weaken path security in this sync |
| Git unstaged discard restores from index (`a1f1c5161`) | **adapt** | Correct Git semantics and independent of upstream UI restyling/i18n bundled in the commit. Port only Rust core/daemon behavior + focused tests. | `git/mod.rs`, desktop/daemon command path |
| Build artifact existence validation (`f95f04ce1`) | **adapt** | Useful, but doge owns signing, bundle names and release trust chain. Port only missing-artifact fail-closed logic compatible with doge build scripts. | `scripts/build-platform.mjs`; release contract tests |
| Claude mid-turn silence hard kill (`0f4730287`) | **defer** | Upstream's 35-minute idle timer still treats absence of output as terminal authority. doge contract prohibits full-turn deadline inference without scoped runtime status; needs backend liveness evidence first. | no code port in this change |
| Frontend zero-first-event orphan timer (`9c81cd42e`) | **reject** | It clears processing after 90s with no authoritative terminal/status proof, directly violating doge terminal authority and long-running turn contract. | retain scoped reconciliation, no timer-based settlement |
| Claude windowed history fidelity (`bb1d06239`) | **defer** | Valuable, but upstream fix depends on the later history paging/window architecture that doge has not adopted wholesale. Porting only the merge helper risks two competing history owners. | evaluate with a dedicated history-window change |
| Shared false-failure retry storm (`ac51d44f9`) | **already-covered / audit** | doge has stronger Attempt-owned typed terminal, canonical commit, recovery-exit and Provider rejection contracts. Audit exact Claude process-exit branch; port only if a missing predicate is proven. | focused existing Shared settlement tests |
| Command/file-change output budget (`f3355b56f`) + later live-lane tail (`2246aa900`) | **adapt / defer live-lane hunk** | Audit found doge had cadence/buffer pressure control but no durable reducer/history cap. Port neutral `boundToolOutput` into reducer + normalization. The later `liveItemDeltaChannel` hunk depends on an upstream-only channel not present in doge and is deferred. | `src/utils/boundToolOutput.ts`, reducer/threadItems tests |
| Client-store raw-string bridge + Markdown worker crash backoff (`61a4669ea`) | **defer** | Valuable performance work, but touches IPC storage serialization and the later fast-Markdown worker architecture. It needs its own performance evidence and stale-settlement matrix. | separate performance change |
| Cache-first engine catalog + fallback recovery (`89ab7f1ee`, `10bee91d6`) | **already-covered / reject upstream owner** | doge Product Home reads entitlement/target projection and lazy provisioning at send boundary; upstream CLI catalog recovery must not become a second Product catalog authority. Legacy provider surfaces may be audited separately. | keep `projectProductTargetCatalogV1` SSOT |
| Session Index cold path, paging, tombstone, focus refresh (`1cdc5732d`…`bc59446a5`) | **defer** | High value but tightly coupled to upstream's new index-first/history-window architecture. Selective hunks would create dual list owners. | dedicated Session Index convergence change |
| AppShell/domain-host refactor and cold-start waves (`5ae96e926`…`bb11d3831`) | **defer** | doge has post-fork Account Gate, lazy engine provisioning and Product target owners in AppShell. Requires a fresh render trace and a semantic host-by-host migration, not a sync patch. | future measured performance change |
| Incremental Markdown + history window performance (`7a0ed607d`…`f81c55a4e`) | **defer** | Potentially useful, but doge streaming render contract and CodeMirror/lazy boundaries require independent benchmarking and regression fixtures. | future measured performance change |
| Search virtualization / lazy Settings sections (`7985e5c8c`, `7a7605aa8`) | **defer** | Product-neutral and likely valuable; low urgency compared with correctness, and component topology differs after doge account/settings changes. | follow-up UI performance change |
| PI / DSH / Qoder runtime, catalog, sessions, background tasks and UI | **reject** | These engines/surfaces are not part of doge's shipping Product target set. Importing them would add unsupported choices and maintenance burden. | no registry/UI/runtime changes |
| Grok/OpenCode-specific fixes | **reject for shipping; retain compatibility only** | doge shipping UI intentionally exposes Codex/Claude/Kimi. Do not reintroduce hidden engine product entries; compatibility reader fixes require separate evidence. | no new visible surface |
| Wallpaper market/fluid effects/theme restyle | **reject** | Cosmetic/market expansion is unrelated to doge current product priority and risks WebView2/native rendering stability. | no sync |
| Upstream analytics/updater/release notes/version bumps | **reject** | doge has an isolated repository, signing/update trust chain and canonical CHANGELOG release gate. | keep doge release workflows and brand facts |
| Upstream tests/governance/docs wholesale | **reject wholesale; reuse evidence** | Upstream OpenSpec/Trellis artifacts describe a different product/version and would corrupt doge sources of truth. Only selected behavior scenarios are rewritten into this change. | doge-local OpenSpec deltas + focused tests |

## Conflict Intent Matrix

| doge customization | Why it exists | Sync rule |
|---|---|---|
| Product Account Gate mounts AppShell after entitlement catalog, not engine readiness | login must never be blocked by CLI install/download | reject any startup engine install/readiness gate |
| Lazy engine provisioning at frozen send target | install only the selected engine; silent when already available | do not import upstream prewarm/readiness chips as Product authority |
| Product protocol → Engine projection | Codex Responses, Kimi Chat Completions, Claude Anthropic Messages are endpoint facts | provider model fixes may enrich metadata but cannot recreate per-surface model lists |
| `projectProductTargetCatalogV1` | one catalog for Composer/Kanban/repair | no upstream global/default catalog fallback in Product mode |
| doge managed Provider identity `doge-token-matrix` | immutable exact binding, isolated home/private settings | env/config fixes must preserve provider binding and native secret ownership |
| externalized live assistant text + terminal authority | avoid root render storms without losing durable final | adopt causal drain/salvage; reject timeout-based fake terminal |
| doge release/changelog trust chain | reviewed bilingual CHANGELOG is release SSOT | reject upstream version/release workflow and notes |

## Deferred Follow-up Candidates

1. Session Index + bounded history windows as one architecture change, including Claude message-loss fix.
2. AppShell host/performance refactor after a new doge render trace.
3. Incremental Markdown + client-store/worker churn under measured performance budgets.
4. Windows network-drive canonicalization with symlink/reparse containment proof.
5. Search virtualization and lazy Settings sections after correctness sync lands.
