# Proposal: 稳定 ProjectMap Windows batched test latency

## Why

main CI run `32825481888` 的 Windows batch 在 `ProjectMapPanel.test.tsx` 中超时：`shows path association explanations inside a collapsed details block` 超过 Vitest 默认 `5000ms`。该用例只验证 `ProjectMapNavigationPanel` 内一个 `<details>` disclosure，却挂载完整 `ProjectMapPanel`、graph、detail、query、activity 与 advisor surfaces；Windows batch 处于持续高负载时，父级 harness 的初始化成本吞掉了 timeout budget。

直接提高 timeout 只会掩盖过重 test scope，且让未来 regression 更慢。Path/association 计算已经由 `utils/navigation.test.ts` 覆盖，UI disclosure 应在最小 leaf owner 上验证。

## What Changes

- 从 `ProjectMapPanel.test.tsx` 删除过重的 association disclosure integration case。
- 新增 `ProjectMapNavigationPanel.test.tsx`，用真实 path/explanation pure helpers 构造 props，只挂载 leaf component。
- 保持同一行为断言：默认 collapsed、点击 summary 后 expanded、relation explanation 可见。
- 不提高 global/test-local timeout，不修改 production component、CSS、i18n 或 Project Map runtime behavior。

## Scope

- Test-only：`src/features/project-map/components/*test.tsx`。
- CI：Windows `scripts/test-batched.mjs` latency stability。
- Release：修复提交 push 后，从该 branch 触发 Windows unsigned NSIS + macOS ad-hoc DMG artifacts。

## Verification

选择 `L2 Feature/Test Harness`：测试发现/分批语义不变，只收窄单个 behavior harness。运行 leaf component test、Project Map navigation pure tests、完整 `ProjectMapPanel.test.tsx`、target ESLint、typecheck、strict OpenSpec 与 diff check；Windows 与 macOS package 交给 release workflow。
