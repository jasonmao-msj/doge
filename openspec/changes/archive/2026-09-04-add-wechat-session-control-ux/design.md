# 微信会话生命周期与控制命令易用性 Design

## 数据模型

`PersistedWechatConversationRoute` 增加 optional `lastActivityAtMs`（serde camelCase）。`None` 表示 legacy route；为保持 backward compatibility，legacy route 在加载后按未过期处理，下一次成功 turn 通过正常 route bind 补齐时间。

生产 expiry policy 为 `24h` inactivity。expiry 是 resume decision，不是 destructive cleanup：expired route 仍可被新成功 turn 覆盖，旧 native session 与 workspace history 保留。

## Ledger API

- `bind_session_at(wxid, target, session_id, now_ms)` 保存 route 和 last activity。
- `session_for_target_at(wxid, target, now_ms)` 仅在 target exact match 且 route 未过期时返回 session id。
- `reset_session(wxid)` 移除 route 与 pending selection，保留 `targets[wxid]`。

`session_for_target` 保留为 test-friendly/default wrapper（使用当前 clock）或由 caller 显式传入时间；expiry 判断集中在 ledger，避免 webhook 和 command caller 各自实现。

## Command UX

`TargetControlInput` 增加 `NewSession` 与 `Help`。parser 在 trim + ASCII lowercase 后识别中英文 aliases：

- new: `/new`, `/new-session`, `/新会话`, `/重新开始`
- help/status: `/help`, `/帮助`, `/target`, `/目标`

`/help` 复用 status formatter；`/new` 成功时返回“当前目标保持不变，下一条普通消息将创建新会话”。target 选择成功回复补充 `/new` 和 `/target` 入口，减少用户再次查找命令的成本。

## Webhook flow

Webhook 继续先拿 per-wxid session lock，再消费 control message。普通消息 dispatch 前调用 `session_for_target_at(now_ms)`；若返回 `None`，传给 engine 的 `continue_session=false`，成功后用 `bind_session_at(now_ms)` 持久化。不会向 native history 写入 reset/help/selection text。

## Error and compatibility

Ledger write failure 必须 rollback in-memory mutation，并返回现有 readable command error。未知 command 仍作为普通 text 交给 engine；pending selection 下未知 text 仍提示数字或 `/cancel`。旧 JSON 缺失 `lastActivityAtMs` 不得 parse failure。
