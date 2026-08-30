# 修复 managed session target 冷启动恢复

## Goal

修复 Native 与 Shared Session 在应用重启后丢失已选 Engine / Provider / Model / reasoning target，或被 Product catalog 默认 GPT 覆盖的问题。

关联 OpenSpec change：`fix-managed-session-target-cold-start`。

## Requirements

- Native Session 使用 durable execution target 恢复完整 catalog/runtime identity。
- Shared Session 读取权威固定为 Shared V2 target 优先于 legacy metadata，且 cold-start read 不写回。
- Shared target 尚未 hydrate 时不得把 Product default 当作用户选择持久化。
- Desktop 与 daemon IPC、send/continuation boundary、managed runtime restore 保持一致。
- 不夹带与 session target cold-start 无关的行为修改。

## Acceptance Criteria

- [x] 选择 managed model 后退出并重新打开同一会话，目标不回落 GPT。
- [x] Shared mount hydration pending 时 selection IPC 为零。
- [x] V2 target 与 legacy metadata 冲突时只读投影 V2 target。
- [x] L3 focused tests、lint、typecheck、runtime contracts 与 Rust checks 通过。
- [x] 用户完成 Windows 真实重启 smoke。

## Technical Notes

Behavior SSOT 位于 `openspec/changes/fix-managed-session-target-cold-start/**`。实现规范同步到 `.trellis/spec/backend/shared-session-v2-send-contract.md` 与 `.trellis/spec/guides/cross-layer-thinking-guide.md`。
