# 微信会话生命周期与控制命令易用性

## Goal

让微信渠道的联系人会话可控、可恢复且不依赖模型记忆控制命令：用户可以在保持当前执行目标的情况下主动开启新 native session；长期不活跃的旧 session 不再自动携带 stale context；控制命令在微信侧持续可发现。

## Requirements

- 新增 `/new`、`/new-session`、`/新会话`、`/重新开始` 控制命令，清除当前 wxid 的 session route，但保留 selected workspace/engine/model。
- 新增 `/help`、`/帮助` 别名，返回当前 target 状态和可用控制命令。
- `/new` 和 target 选择成功后的回复必须明确告知下一条普通消息会创建/使用哪一类 session。
- session route 记录 `lastActivityAtMs`；连续 1 天无活动时视为 expired，下一条普通消息创建新 native session，旧桌面历史不删除。
- 旧版 ledger 缺少时间字段时保持可读并按未过期处理，首次成功 turn 后补齐时间。
- 控制命令仍在 agent dispatch 前消费，不进入 native conversation history；联系人之间的 target、route 和 pending selection 继续隔离。

## Acceptance Criteria

- [x] 同一 wxid、同一 target 且未过期时继续原 session。
- [x] `/new` 后同一 target 的下一条普通消息不再 resume 原 session。
- [x] 过期 route 不被 resume，下一轮成功后 route 时间更新。
- [x] `/help`、中文别名和数字选择流程均可用，控制消息不进入 native history。
- [x] 旧 ledger JSON 可加载；持久化仍使用既有 atomic/locked storage helper。
- [x] Rust focused tests 覆盖 fresh/legacy/expired/manual reset/联系人隔离场景。

## Definition of Done

- Rust implementation and focused regression tests complete.
- OpenSpec change records behavior and design.
- Verification level, commands, and untested L4 scope are reported.

## Out of Scope

- 不删除或归档桌面端已有 native session。
- 不新增设置页 TTL 配置。
- 不实现微信多账号、群聊 target 或自然语言意图识别。

## Technical Approach

- 在 `PersistedWechatConversationRoute` 增加 optional `last_activity_at_ms`，避免破坏旧 ledger。
- `session_for_target_at` 通过注入的 `now_ms` 进行 bounded expiry 判断；生产调用使用当前 Unix epoch milliseconds，测试使用固定时间。
- `WechatMessageLedger::reset_session` 只移除 route 和 pending selection，不修改 selected target。
- 命令 parser 负责 alias normalization；`/help` 复用 target status projection，避免维护第二套 command help 文案。

## Verification

- Level: L3 Cross-layer / High-risk（session route persistence 与 resume decision）。
- Planned: `cargo test --manifest-path src-tauri/Cargo.toml wechat::`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`（若 workspace script 支持则按实际可用命令执行）。
- Not planned: L4 full test/build/release smoke and cross-platform package validation。
