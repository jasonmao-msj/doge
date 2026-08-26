# 修复 Codex 创建与续借引擎路由

## Goal

修复从侧栏创建 Codex 会话时实际 runtime 仍使用旧 engine，以及 Provider Continuation 切换到 Codex 后 Composer 仍展示来源 engine 的问题。

## Requirements

- 新建会话在调用 `start_thread` 前必须确认 native engine 已切换到目标 engine。
- engine switch 失败时必须停止创建并保留可诊断错误，不得静默使用旧 engine。
- Provider Continuation hydration 必须确认目标 engine 后再选择目标 thread，并保持 Composer 的 engine/model 与目标一致。
- 不改变 Shared Session 的 durable `ExecutionTarget` authority，也不引入第二套 engine state。

## Acceptance Criteria

- [x] 从非 Codex 会话点击侧栏 Codex，`startThreadForWorkspace` 使用 `engine: "codex"` 且 native engine 已确认。
- [x] engine switch 失败时不调用 `start_thread`，不导航到错误 engine。
- [x] 从其他 provider 续借到 Codex 后，目标 thread 首帧的 Composer engine/model 为 Codex target。
- [x] 现有 provider profile、Codex pending finalize、非 Codex 创建路径保持通过。

## Technical Notes

OpenSpec change: `fix-engine-routed-session-launch`。
本次属于 L3 engine routing / session creation / provider continuation 变更；验证 focused Vitest、TypeScript、target ESLint、runtime/engine contracts。
