# Proposal: 修复 Messages dependency boundary regressions

## Why

`main` 的 CI `typecheck` job 在 TypeScript 编译前被 `npm run check:messages-boundaries` 阻断。当前 graph 为 `inbound=14`、`outbound=69`、`new=35`，相同失败至少从 2026-08-20 延续到当前 merge commit；这不是 PR #23 引入，但会让后续所有 PR 无法获得完整 macOS / Windows build coverage。

这些边界回归来自三类 ownership drift：外部 feature deep-import Messages private implementation、Messages 直接消费 peer feature primitive，以及 integration test 直接操纵无关 peer store。简单扩充 exact baseline 会把新增 architecture debt 永久合法化，并违背 `messages-final-boundary-enforcement` 的 zero-inbound contract。

## What Changes

- 将 cross-feature conversation runtime / presentation primitives 移到 `src/conversation-presentation/**`、`src/contracts/**`、`src/services/**` 或 `src/utils/**` neutral owners，并迁移全部 caller。
- 将 Shared canonical projection 移回 `src/features/shared-session/**` owner；Messages tests 使用 presentation fixture，不再反向依赖 Shared feature implementation。
- 将 Prompt Distill 与 Multi-Agent History Fold 改为 host composition/slot：Messages 只发布 intent 或消费 render slot，不直接 import peer UI feature。
- 仅对稳定的 Messages public capability 通过 `src/features/messages/index.ts` 暴露，禁止 external deep import。
- 删除无行为作用的 peer-store test coupling，并把 exact outbound baseline 收缩到修复后的真实 graph；不得新增 baseline exception。
- 修复 Windows test runner 将 `node:path.relative()` 的 `\\` path 直接用于 `/` provenance allowlist 的跨平台误报，保证解除 typecheck 阻断后 Windows integration 能继续推进。
- 补充/保持 boundary checker、streaming、history projection、prompt distill composition 与 timeline fold focused regression。

## Scope

- Frontend architecture：Messages、Threads、Layout、Shared Session、Multi-Agent、Files、Tasks 之间的 owner/import direction。
- CI contract：`check:messages-boundaries` exact baseline 与对应 deterministic tests。
- Test infrastructure：`upstreamServiceIsolation` repository path normalization。
- 不修改 runtime protocol、canonical persistence schema、消息渲染行为、stream cadence、Shared owner/settlement authority 或用户可见 copy。

## Verification

选择 `L3 Cross-layer / High-risk`：虽然主要是 TypeScript move/refactor，但影响 Messages streaming hot path、Shared history projection、Layout composition 与 CI gate。执行 boundary gate、focused Vitest、target ESLint、`npm run typecheck`、runtime contracts、large-file/heavy-test-noise sentry、strict OpenSpec、`git diff --check`；L4 跨平台 build 留给新 PR CI。
