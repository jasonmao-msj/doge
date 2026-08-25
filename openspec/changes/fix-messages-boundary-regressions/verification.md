# Verification: Messages boundary regression repair

## Result

- Source graph：`inbound=0 (baseline 0)`、`outbound=40 (baseline 40)`、`new=0`。
- 初始 35 条新增 edge 全部偿还；outbound debt baseline 从 50 收缩到 40，没有新增 exception。
- Prompt Distill 与 Multi-Agent History Fold 由 main Layout 和 nested Subagent Canvas 两个 production entry host-compose；MessagesCore 不再 import peer UI feature。
- live text / realtime flag / scheduling owner 迁移后仍为单一 module singleton；focused cadence、terminal drain、rename、flag reset tests 全绿。

## Verification level

`L3 Cross-layer / High-risk`。最高风险是 conversation streaming singleton 与 Messages timeline composition 的 ownership move；影响面包含 Messages、Threads、Layout、Shared Session、Multi-Agent、Files、Tasks、CI/branding/docs contracts。无 Rust、database schema、IPC payload 或 runtime protocol 行为变更。

## Passed commands

- `npm run check:messages-boundaries` → `0 / 40 / new=0`。
- Focused Vitest（30+ files，包含 boundary fixtures、live-text、realtime flags、render scheduling、Shared projection/history、Messages rows/timeline、Prompt Distill hosts、History Fold slot、file primitives、task navigation、subagent classifier）→ all passed；主矩阵一次为 `319 passed | 2 skipped`，后续 composition regression `48 passed | 2 skipped`。
- changed TS/TSX `npx eslint` → pass。
- `npm run typecheck` → pass。
- `npm run check:runtime-contracts` → pass。
- `npm run doctor:strict` → pass。
- `npm run check:branding:test` → 5/5 pass；neutral owner compatibility allowlist 已迁移到 canonical paths。
- `npm run check:engine-capability-matrix` → pass。
- `npm run check:docs` → pass。
- `npm run check:large-files` → exit 0；本 change 未新增超过 new-file threshold 的文件。
- `npx openspec validate fix-messages-boundary-regressions --strict --no-interactive` → pass。
- `git diff --check` → pass。

## L4 / unrelated evidence

`npm run check:heavy-test-noise` 不是本次 L3 的 blocking gate，但做了扩展探测：先发现并修正本 change 引起的 `appShellLazyBoundaries` stale exact-JSX assertion；重跑后继续到 batch 67 / file 268，因未触碰的 `ComposerBranchBadge.test.tsx` popover 查询失败而停止。报告同时记录仓库既有 `AskUserQuestionDialog` / `ButtonArea` / `ProviderSelect` act warnings 与少量已存在 stdout/stderr。上述文件均不在本 change impact surface，未夹带修复；PR CI 的正式 `test-js` 将给出 terminal evidence。

手动 dispatch [CI run 32814979384](https://github.com/jasonmao-msj/doge/actions/runs/32814979384)：attempt 1 的四个长 job 被 GitHub Actions internal error 同时取消；attempt 2 中 `typecheck`（含 Messages boundary + tsc）、`lint`、`docs`、`test-js` 全量、`memory-kind-contract` 与 `build-macos` 均通过。Windows integration 暴露 test-infra path separator bug：`relative()` 在 Windows 返回 `\\`，而 developer provenance allowlist 使用 `/`，导致四个明确允许项误报；已用 `normalizeRepoPath()` 修复并增加 Windows-style regression，local 3/3 pass。Rust full test 1147/1148 pass，唯一失败 `engine::status::tests::hanging_probe_times_out_and_terminates_its_process_group` 是未触碰的 process-group timing test；follow-up CI rerun 待记录。

follow-up [CI run 32818081850](https://github.com/jasonmao-msj/doge/actions/runs/32818081850)：同一 Rust full suite 重跑通过，确认前次 process-group failure 为 timing flake；Windows 越过 provenance test，推进到 batch 88 后暴露 CSS CRLF exact-source assertion，已用 `normalizeLineEndings()` 修复并增加显式 CRLF regression，local 8/8 pass。`test-js` 此次被未触碰的 `FileViewPanel.capture-note` shortcut selection timing flake 阻断；上一 run 全量 JS 已通过。最终 follow-up CI 待记录。

## Manual / platform scope

- 未做 Tauri Desktop 目视 smoke：本 change 无 copy/CSS/DOM geometry 与 runtime protocol 变化，host composition 已由 React behavior + static contract 覆盖。
- 未本地执行 Windows/macOS package build；交给 PR CI L4 jobs。
