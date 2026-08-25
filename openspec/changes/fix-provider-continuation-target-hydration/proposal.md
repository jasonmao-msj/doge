# Proposal: 修复 Provider Continuation target hydration

## Why

真实 Desktop 复现显示 Codex → Claude Provider Continuation 的 backend operation 已两次进入 `ready`，目标 Session 分别为 `claude:ab82…` 与 `claude:9f50…`；但选择新 Session 后 Composer 仍显示来源 Codex 的 `gpt-5.6-sol`。用户手动选择 Claude model 时，frontend 因 stale active engine/model 又发起 Claude → Claude Continuation，最终在空 control-only source 上失败。

当前成功链存在两个 race：

1. `useSidebarMenus.confirmProviderContinuation()` 先 `onSelectThread()`，再 fire-and-forget `onProviderContinuationTargetReady()`；新 thread 首次 selection reload 可能早于 target-specific selection 写入。
2. `handleSelectThread()` 从刚 reload 的 `threadsByWorkspace` 闭包推断 engine；同一 batched turn 中 catalog state 可能尚未进入该闭包，使全局 `activeEngine` 继续停留在来源 Codex。

## What Changes

- Provider Continuation `ready` 后，先 await destination target hydration，再选择 exact target thread。
- Target hydration 以明确的 `workspaceId + threadId` 写入 per-thread Composer selection，并显式收敛 destination engine。
- 删除对 source/current thread 的 `handleSelectModel` / effort 补写；target 尚未 active 时不得污染来源会话。
- 目标 thread selection 只执行一次，并从已写入的 engine/model/effort truth 首帧完成 Composer hydration。
- 增加 async ordering、source-isolation、same-binding model selection regression。

## Scope

- Frontend：`useSidebarMenus` ready ordering、`useAppShellLayoutNodesSection` target hydration、相关 tests。
- Behavior spec：`native-provider-continuation`。
- 不修改 Rust target creation、Context Package、Claude bootstrap、operation recovery 或 catalog schema。

## Verification

选择 `L3 Cross-layer / High-risk`：虽然预计代码落点在 frontend，行为位于 Provider Continuation ready → catalog reload → engine/model state → exact thread selection 的跨层终态边界。运行 focused Vitest、typecheck、target ESLint、runtime/capability contracts、OpenSpec strict validation、targeted Rust continuation regression（若 Rust 零改动只验证现有 contract test），并以 hot Desktop 重跑 Codex → Claude → Claude first user turn。
