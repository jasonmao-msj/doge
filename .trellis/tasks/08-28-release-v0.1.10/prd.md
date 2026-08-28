# 准备并发布 doge v0.1.10

## Goal

基于已合入 PR #44 的 Release Changelog Gate，完成一次可审计的 signed Release；避开 origin 中
`v0.1.4`～`v0.1.9` 上游遗留 tags，将下一个 doge 版本发布为 `v0.1.10`。

关联 OpenSpec change：`enforce-release-changelog-gate`。

## Requirements

- 从最新 `origin/main` 准备 release，不删除或改写历史 tags。
- 同步 `config/brand.json`、npm manifest/lock、Cargo manifest/lock、Tauri config 到 `0.1.10`。
- 在 `CHANGELOG.md` prepend `v0.1.10` 双语用户可读 entry，只总结 `v0.1.3..main` 的真实用户变化。
- signed Release preflight 必须在 platform matrix 前拒绝已存在的目标 tag。
- CI contract 覆盖 tag collision gate；release preparation PR 合入后从 `main` dispatch。
- workflow inputs 必须显式设置 `windows_artifact_only=false`、`macos_artifact_only=false`。
- Windows CI batched Vitest 对单个 transient test最多 retry 1 次，保留原 5000ms timeout；不得用全局放宽 timeout掩盖确定性 hang。
- Unix CLI probe cleanup test必须区分 live descendant 与 SIGKILL 后等待 init reaping 的 transient zombie；在 cleanup timeout内 poll `ESRCH`，不得改变 production probe deadline。

## Acceptance Criteria

- [x] `v0.1.10` 在 origin tags 与 GitHub Releases 中均不存在。
- [x] `npm run release:check` 对七个 version facts 与 current CHANGELOG entry 通过。
- [x] workflow contract 证明 existing tag 会阻断 signed release preflight。
- [x] L3 release-preparation checks 通过并创建、合入独立 PR。
- [ ] signed Release workflow 从 `main` 启动并产出 `v0.1.10` Release。
- [ ] Release tag 指向触发 workflow 的 main commit，`latest.json` 与 Release notes 使用 current CHANGELOG。
- [x] Windows CI retry contract有 parser/argument/workflow tests；默认与非 Windows callers保持零 retry。
- [x] Unix hanging-probe regression在连续重复运行下稳定，并继续证明 descendant最终消失。

## Technical Approach

- Version selection：保持 `0.1.x`，选择第一个未占用的 `0.1.10`，不 destructive retag。
- Collision gate：preflight 从 canonical Tauri version构造 `refs/tags/vX.Y.Z`，通过
  `git ls-remote --exit-code --tags origin` fail closed。
- Notes：AI curate bilingual entry；workflow继续只 extract committed current entry。
- Windows flake recovery：`scripts/test-batched.mjs` 从 bounded `VITEST_RETRY`生成 Vitest
  `--retry`；仅 `test-windows` 设为 1。三次 main CI分别在三个无关 UI tests发生同型 5000ms timeout，
  证明是 runner timing jitter；不修改 test timeout。
- Unix process-group regression：`killpg(SIGKILL)` 后 leader可立即 reap，但 background descendant由 init
  异步 reap；`kill(pid, 0)` 在 zombie窗口仍返回 0。测试在 `DETECTION_CLEANUP_TIMEOUT` 内 bounded poll
  `ESRCH`，超时仍失败；production `run_cli_probe` 与 cleanup行为不变。

## Verification Level

本地 **L3 Cross-layer / High-risk**：版本、CI/Release preflight 与 updater metadata source。执行
release checks、workflow/build contracts、branding、typecheck、Cargo metadata、OpenSpec strict 与 diff check。

正式 workflow 是 **L4 Release/CI**：多平台 build、signatures、installer/startup smoke、Release assets 与
`latest.json` 由 GitHub Actions 验证。

## Out of Scope

- 删除或重写 `v0.1.4`～`v0.1.9` legacy tags。
- 新增产品功能或修改 App UI。
