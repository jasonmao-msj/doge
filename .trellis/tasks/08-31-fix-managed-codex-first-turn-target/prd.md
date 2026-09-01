# 修复托管 Codex 首轮模型漂移

OpenSpec change: `fix-managed-codex-first-turn-target-drift`

## Goal

保证 Product managed Native Codex 的 UI target、send snapshot、durable target 与 Codex runtime model 完全一致；升级 existing install 的 unsafe `gpt-5.5` fallback，并让 Shared CLI 的真实生图结果安全持久化、即时显示和历史恢复。

## Requirements

- Codex managed config fallback/review model=`gpt-5.6-sol`。
- configuration revision bump，old users exact-engine prepare 自动生效。
- Native Product target unresolved 时禁发，不 fallback。
- managed Native send 显式携带 catalog/runtime/effort identity。
- Kimi/local/custom behavior unchanged。
- Shared terminal 从 exact provider/native-session/runtime-turn rollout 提取图片，canonical 只保存 compact artifact ref。
- Existing users 更新后无需清配置、重新登录或重建会话。

## Acceptance Criteria

- [x] New Native managed Codex immediate first send uses displayed model。
- [x] revision-2 config migrates to current Sol fallback。
- [x] target unresolved produces zero send/session fallback side effect。
- [x] Shared generated image survives current timeline refresh and history reload。
- [x] focused L3 verification and Hot Doge smoke pass。

## Verification

Risk level: L3 provider/model routing + persisted configuration migration + Shared canonical artifact projection。
