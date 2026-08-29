## 1. Explore 与 Change 基线

- [x] 1.1 [P0][Depends:none][Input: `origin/main@e0cad68d8`, `upstream/main@cd362f8cf`, merge-base `2da6da398`][Output: capability/domain 聚类与 divergence evidence][Verify: `git rev-list --left-right --count origin/main...upstream/main` = `251 476`] 完成 upstream 差异审计。
- [x] 1.2 [P0][Depends:1.1][Input: 429 个 non-merge upstream implementation commits + doge 产品 contract][Output: `upstream-capability-matrix.md` 的 adopt/adapt/already-covered/reject/defer 结论][Verify: matrix 覆盖 correctness/provider/platform/performance/session/engine/UI/release/governance 主要域] 固化 selective sync 决策。
- [x] 1.3 [P0][Depends:1.2][Input: proposal/design/spec deltas][Output: apply-ready OpenSpec change][Verify: `openspec validate sync-upstream-stability-2026-08 --type change --strict --no-interactive`] 完成 propose 阶段。

## 2. Terminal Text Integrity

- [x] 2.1 [P0][Depends:1.3][Input: upstream `0d8f2426c`, doge normalized realtime batcher/live channel][Output: shared pure late-completion salvage predicate][Verify: predicate tests cover non-empty assistant complete vs delta/tool/mismatch] 新增 exact content salvage contract。
- [x] 2.2 [P0][Depends:2.1][Input: `flushPendingRealtimeEvents`, `settleCompletedTurn`][Output: terminal 前同步 drain legacy/normalized/contract batcher/live-tail，deferred path parity][Verify: focused fake-timer tests prove cadence tail enters reducer before barrier] 移植 causal drain。
- [x] 2.3 [P0][Depends:2.2][Input: terminal exact/quarantine guards][Output: late full assistant completion content-only salvage][Verify: late final updates durable text exactly once and never revives processing/active turn] 移植 late final salvage。
- [x] 2.4 [P1][Depends:1.3][Input: upstream `f3355b56f`, doge tool-output tail gate][Output: neutral command/file-change retained output budget at reducer + history normalization][Verify: bounded helper/reducer tests preserve head/tail/omitted count and larger file-change budget] 限制长命令输出状态增长。

## 3. Codex Provider / Model Facts

- [x] 3.1 [P0][Depends:1.3][Input: upstream `41222cc2a`, current UsageUpdate mapping][Output: missing context window stays `None/null`][Verify: Rust adapter + `useAppServerEvents.tokenUsage` focused tests] 移除伪造 200K context window。
- [x] 3.2 [P0][Depends:1.3][Input: upstream `0f90c742b`, doge provider/Product catalog boundaries][Output: Codex scoped provider catalog skips official generated fallback without changing Product target projection][Verify: `engine::status` tests cover Codex empty/subset and Claude/Kimi unchanged] 修复幽灵模型。
- [x] 3.3 [P1][Depends:3.2][Input: upstream `2eefc6724`/`474fe8159`, `modelCatalogEntryId` vs runtime model contract][Output: runtime reasoning metadata preservation/fill-only helper][Verify: provider-owned metadata wins, authoritative identity fills missing, unknown remains neutral] 对齐 reasoning facts。
- [x] 3.4 [P0][Depends:1.3][Input: upstream `6c9c9cfc1`/`b4dcd1538`, managed Codex profile config][Output: Rust-only bounded bulk `env_key` resolver wired to desktop and `doge_daemon`][Verify: missing/present/multiple env tests, redaction assertion, `cargo check --bins`] 修复 GUI/daemon provider env 解析。

## 4. Desktop Cross-Platform Guardrails

- [x] 4.1 [P0][Depends:1.3][Input: upstream `637ba9a5a` + Box-only hunks of `a561424a1`][Output: Windows `doge` 8 MiB stack reserve + selected deep future boxing][Verify: static linker-target test/inspection, focused Rust compile/tests] 降低 Windows 栈溢出风险。
- [x] 4.2 [P1][Depends:1.3][Input: upstream `4fac18094`/`7b552c6cb`][Output: already-covered/not-applicable evidence; no parallel helper introduced][Verify: current open-app path uses existing owners and `rg 'process_is_alive|command_resolvable_on_path'` has no production helper] 核对平台 command/process 行为。
- [x] 4.3 [P1][Depends:1.3][Input: upstream `add5ba06c`, Native WebView risk gate][Output: renderer F5 guard + Windows-only failure-safe native hook][Verify: Vitest modifier/input cases, Rust unit/compile evidence, non-Windows no-op] 防止主窗口误刷新。

## 5. Local File Link 与 Git Safety

- [x] 5.1 [P1][Depends:1.3][Input: upstream `0004b75b4`, doge current Markdown pipeline][Output: drive/UNC/POSIX/relative local reference normalization without presentation refactor][Verify: remark/resource/Markdown tests cover encoded paths, line/column, ordinary web links] 修复 Windows Markdown 文件链接。
- [x] 5.2 [P0][Depends:1.3][Input: upstream `a1f1c5161`, current desktop/daemon discard paths][Output: shared Git core restores unstaged working tree from index][Verify: staged+unstaged fixture preserves staged diff in desktop and daemon tests] 修复 discard 语义。
- [x] 5.3 [P0][Depends:1.3][Input: upstream `0e9ee549b`][Output: documented defer with no blanket canonicalize fallback][Verify: current path-containment tests remain unchanged; no `canonicalize_or_original` added to external mutation boundaries] 保持 filesystem fail-closed。

## 6. Build 与 Already-Covered Audit

- [x] 6.1 [P1][Depends:1.3][Input: upstream `f95f04ce1`, doge build/signing workflow][Output: build-platform missing-artifact fail-closed checks using doge bundle names][Verify: script contract tests cover success/missing artifact and no trust-chain bypass] 加固 build 产物判定。
- [x] 6.2 [P1][Depends:2.3,3.4,4.3,5.2][Input: upstream retry/output/cache/session fixes marked already-covered][Output: code evidence table confirming doge equal/stronger paths or promoted follow-up][Verify: exact symbols/tests referenced in verification.md] 复核 already-covered 结论。
- [x] 6.3 [P0][Depends:6.2][Input: engine/provider/terminal changes][Output: foundation ADR 最近校准/当前实现校准 rows updated with code facts][Verify: ADR update trigger checklist complete] 回写 multi-CLI foundation calibration。

## 7. L3 Verification 与交付

- [x] 7.1 [P0][Depends:2.3,3.4,4.3,5.2,6.1][Input: changed frontend/backend files][Output: focused Vitest/Rust/type/contract results][Verify: nearest suites + `npm run typecheck` + `npm run check:runtime-contracts` + `cargo check --lib --bins` + targeted ESLint/rustfmt] 执行 L3 verification。
- [x] 7.2 [P0][Depends:7.1][Input: final code/spec/matrix][Output: `verification.md` with commands, results, L4 gaps and platform evidence levels][Verify: no claimed Windows runtime evidence beyond CI/static tests] 记录验证证据与剩余风险。
- [x] 7.3 [P0][Depends:7.2][Input: completed tasks and specs][Output: strict-valid OpenSpec change, synced index metadata and clean diff][Verify: strict change validation + `git diff --check` + isolation/branding/upstream-sync gates] 收口 apply change。
- [x] 7.4 [P1][Depends:7.3][Input: reviewed working tree][Output: Chinese Conventional Commit, Trellis session record, pushed branch and PR][Verify: commits present, workspace clean, PR body includes matrix/verification/L4 gaps] 提交交付。
