# Proposal: 收敛 Codex 创建与续借的 engine authority

## Why

侧栏的新建菜单已经把 `engine: "codex"` 传到 frontend，但 `start_thread` 的 backend contract 仍依赖 native runtime 当前 engine。现有 `setActiveEngine` 在部分失败场景只记录 debug 后返回，创建流程仍会继续，因而会出现“点击 Codex，创建出的会话实际属于旧 engine”。

Provider Continuation 也需要相同的保证：目标 target 的 engine 必须先成为 runtime authority，Composer 才能选择并展示目标 thread；不能只依赖 React 中可能过时的 `activeEngine`。

## What Changes

- `setActiveEngine` 返回可观察的 `boolean` 成功语义；同值调用仍视为已满足 frontend state，但 persistent Codex 与 managed Codex/Claude 的创建/续借流程使用 `ensureRuntime` 复核 native engine。Kimi 等 one-shot provider 保持显式 provider/session routing，不被 global active-engine failure 阻断。
- `useWorkspaceActions` 在 `start_thread` 前执行目标 engine ensure；ensure 失败则停止创建并沿用既有错误通知链。
- Provider Continuation target hydration 使用同一 ensure contract，然后再写 exact target composer selection 和导航。
- 增加 Codex create、switch failure、continuation-to-Codex regression tests。

## Scope

- Frontend engine controller、workspace session creation、provider continuation hydration。
- 不修改 Rust `start_thread` payload shape；不改变 Shared Session durable target ownership。

## Verification

选择 `L3 Cross-layer / High-risk`：变更影响 `React -> engine bridge -> native runtime -> session creation/continuation -> Composer projection`。运行 focused Vitest、`npm run typecheck`、target ESLint、runtime/engine contract checks 和 `git diff --check`；未运行 L4 全量 suite 与跨平台 packaging。
