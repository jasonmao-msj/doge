# Verification

## Verification Level

本 change 按 **L3 Cross-layer / High-risk** 验证：影响 React hydration、Tauri IPC、Rust
durable metadata、engine send boundary 与 managed runtime restore。验证聚焦受影响路径，未
执行 L4 full suite 或 packaged platform smoke。

## Executed Commands

- `npm run typecheck` - passed。
- `npx eslint src/app-shell.tsx src/app-shell-parts/useAppShellComposerModelSection.ts src/app-shell-parts/useAppShellComposerModelSection.test.tsx src/app-shell-parts/useSelectedComposerSession.ts src/app-shell-parts/useSelectedComposerSession.test.tsx src/features/threads/hooks/useThreadActions.threadList.test.ts src/features/threads/hooks/useThreadActions.threadList.ts src/features/threads/hooks/useThreadActions.helpers.ts src/features/threads/hooks/useThreadMessaging.ts src/features/threads/hooks/useThreadsReducer.ts src/features/engine/hooks/useEngineController.ts src/services/tauri.ts src/services/tauri/appServer.ts src/services/tauri/messaging.ts src/services/tauri/sessionManagement.ts src/services/tauri/sessionManagement.test.ts src/types/conversation.ts` - passed；无 error。
- `npm exec vitest run src/app-shell-parts/useAppShellComposerModelSection.test.tsx src/app-shell-parts/useSelectedComposerSession.test.tsx src/services/tauri/sessionManagement.test.ts` - passed，3 files / 33 tests。
- `npm run check:runtime-contracts` - passed。
- `cargo check --manifest-path src-tauri/Cargo.toml --lib` - passed；仅仓库既有 warnings。
- `cargo test --manifest-path src-tauri/Cargo.toml session_management::tests::execution_target --lib` - passed，2 tests。
- `cargo check --manifest-path src-tauri/Cargo.toml --bin doge_daemon` - passed；daemon target read/write RPC dispatch compiles。
- `npm exec vitest run src/app-shell-parts/useSelectedComposerSession.test.tsx src/services/tauri/sessionManagement.test.ts src/features/threads/hooks/useThreadsReducer.test.ts --pool=forks --maxWorkers=1 --minWorkers=1` - passed，3 files / 93 tests。
- `git diff --check` - passed。

- 最终 pre-PR focused Vitest（Product target、Composer hydration、Shared history、Layout、Thread messaging/reducer、Sidebar snapshot、Tauri mapping）- passed，12 files / 346 tests。
- `npm run check:runtime-contracts` - passed；AppShell 与 git-history runtime contract 均为 `OK`。
- `cargo test --manifest-path src-tauri/Cargo.toml execution_target --lib` - passed，15 tests；另执行 Shared V2 read-authority regression，1 test passed。
- `cargo check --manifest-path src-tauri/Cargo.toml --lib` - passed；仅既有 warnings。
- `openspec validate fix-managed-session-target-cold-start --strict --no-interactive` - passed。
- `npm exec vitest run src/features/composer/components/Composer.file-reference-token.test.tsx src/features/threads/loaders/sharedHistoryLoader.test.ts src/features/layout/hooks/useLayoutNodes.client-ui-visibility.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1` - passed，3 files / 93 tests。
- `npx eslint src/features/composer/components/Composer.tsx src/features/composer/components/Composer.file-reference-token.test.tsx src/features/layout/hooks/useLayoutNodes.tsx src/features/layout/hooks/useLayoutNodes.client-ui-visibility.test.tsx src/features/threads/loaders/sharedHistoryLoader.ts src/features/threads/loaders/sharedHistoryLoader.test.ts` - passed。
- `cargo test --manifest-path src-tauri/Cargo.toml shared_v2_target_wins_over_stale_legacy_meta_without_writing_either_store --lib` - passed，1 focused Rust authority regression。
- `cargo check --manifest-path src-tauri/Cargo.toml --bin doge_daemon` - passed；仅仓库既有 warnings。
- `rustfmt --edition 2021 --config skip_children=true --check <changed-rust-files>` - passed；全仓 `cargo fmt --all --check` 仍仅被既有 `src-tauri/src/codex/doctor.rs` 与 `src-tauri/src/engine/kimi_launch.rs` 格式差异阻塞。
- Windows debug App 真实 restart smoke - passed；用户重新选择 managed 豆包 target、退出并重新打开同一 Shared Session 后未回落 GPT，legacy `meta.json` 与 `shared_sessions_v2.selected_target_json` 均保持同一 target。

## Covered Regression Points

- durable `modelCatalogEntryId` / runtime `model` / `reasoningEffort` survives metadata reload。
- Codex prefixed session ids resolve the canonical target key and delete it with session metadata。
- target projection remains present when provider continuation metadata is also applied。
- durable target takes precedence over stale `selectedModelByThread.*` cache and mirrors the cache
  only as compatibility state。
- catalog normalization preserves target fields。
- first-paint active native session can hydrate through targeted durable reader without full catalog scan。
- reducer publishes a list update when only durable target fields change。
- selecting a model on an existing native session immediately maps and dispatches the durable target
  command；Shared V2 `shared:` sessions are excluded。
- Product Native selection keeps `modelCatalogEntryId` and runtime `model` separate；legacy `{id: "豆包", model: "豆包"}` is canonicalized to the real Product catalog entry before persistence。
- Plan apply and related session surfaces use the effective active-thread engine during cold start instead of the stale global engine.
- Product-ready Shared Composer 在 durable target 尚未 hydrate 时不会持久化 catalog default；
  automatic repair 仅接受已 resolved 的 existing target。
- Shared V2 row target 优先于 stale legacy meta，load/list 只读投影 target engine，且不会在
  cold-start read 中改写任一存储。
- Layout 将 native runtime model identity 与 durable persistence callback 完整透传到 Composer。

## Not Covered

- L4 full Vitest suite, packaged Windows/macOS/Linux builds, and packaged smoke tests。
- Live provider CLI/API behavior and real process restart on every supported platform。
- `npm run doctor:strict` 的 strict doctor 仍因环境缺少 `cmake` 失败；其中 runtime contract 与
  branding checks 已通过。
- 未执行 packaged installer smoke；本轮通过的是 Windows debug App 真实退出/重启生命周期。
