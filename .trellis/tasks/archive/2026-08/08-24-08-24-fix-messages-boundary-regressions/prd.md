# 修复 Messages 边界回归并恢复 CI

## OpenSpec

- Change: `fix-messages-boundary-regressions`
- Baseline: `main@dc3958b81`
- Branch: `codex/fix-messages-boundary-regressions`

## Problem

`npm run check:messages-boundaries` 当前报告 `inbound=14`、`outbound=69`、`new=35`，使 CI `typecheck` job 在 `tsc` 前失败，并跳过跨平台 build jobs。

## Requirements

1. 不扩大 exact debt baseline；terminal graph 必须 `inbound=0`、`new=0`。
2. 共享能力迁入 canonical neutral owner，禁止通过 re-export shim 隐藏 peer dependency。
3. Prompt Distill / Multi-Agent History Fold 使用 Layout host composition 或 render slot。
4. 保持 live text 48ms publish cadence、Shared canonical projection、timeline anchor、Prompt Distill 行为不变。
5. 不修改 `.claude/settings.local.json`，不夹带用户本地变更。

## Acceptance

- Boundary gate、focused regressions、target ESLint、typecheck、runtime contracts、large-file/heavy-test-noise、strict OpenSpec、diff check 通过。
- 使用中文 Conventional Commit 提交，push 分支并以当前 `gh` identity 创建 PR。
- PR CI 至少进入运行并检查失败归因；不在本任务中 merge。
