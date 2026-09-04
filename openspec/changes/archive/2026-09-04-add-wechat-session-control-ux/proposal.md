# 微信会话生命周期与控制命令易用性 Proposal

## Why

当前 WeChat channel 以 `wxid -> session route` 持久化联系人上下文。同一 execution target 会无限 resume 同一个 native session，只有 target 改变才会创建新 session；同时控制面依赖用户记住多步 slash commands 和数字回复，命令虽然在 dispatch 前处理，却不够 discoverable。

## 目标

提供显式的新会话入口和 bounded inactivity expiry，并让控制命令在微信侧可反复发现。新会话只改变联系人到 native session 的 route，不改变联系人 selected target，也不删除 desktop history。

## What Changes

- `/new`、`/new-session`、`/新会话`、`/重新开始`：clear current route and pending selection，保留 selected target。
- `/help`、`/帮助`：显示当前 target 与完整 command help。
- route `lastActivityAtMs`；1 天无普通消息活动视为 expired。
- legacy ledger dual-read：缺失时间字段的 route 仍可 resume，成功 turn 时写入新字段。

## 非目标

- 不新增 Tauri command、settings field 或 UI 设置页。
- 不删除旧 session，不做自然语言“切换到 Claude”解析。
- 不改变 desktop Composer、global execution target 或 WeChat provider login session。

## 验收口径

- manual reset、expiry 和 target switch 都保证下一普通消息不会错误 resume 旧 target/session。
- target 与 route 的 persistence、联系人隔离、legacy compatibility 保持不变。
- commands 在 engine dispatch 前消费，native history 中没有 control messages。
