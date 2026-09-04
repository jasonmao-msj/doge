# WeChat Bridge Channel Session Control Delta

## MODIFIED Requirements

### Requirement: 入站消息 MUST 路由到稳定 session 且去重

- 设置页 MUST NOT 要求用户选择 workspace、engine 或 model；bridge 地址、内部密钥与 webhook wiring 仍 MUST 由 Doge 自动管理。
- 系统 MUST 在微信内支持 `/target`、`/help`、`/workspace`、`/engine`、`/model`、`/new`、`/cancel`、中文 aliases 与数字回复完成 target 查看、选择、reset 和取消。控制消息 MUST 在 agent dispatch 前消费，MUST NOT 进入 native conversation history。
- 系统 MUST 按 `wxid` 独立持久化 selected execution target、pending selection 与 session route；一个联系人切换 target MUST NOT 修改全局 channel settings 或其他联系人的 target。`/new` MUST 清除当前联系人 session route 与 pending selection，但保留 selected target。
- 新联系人尚未选择完整 target 时，普通消息 MUST 返回选择引导，MUST NOT 使用任意 global/default target 创建 session。
- Product-ready 的 engine/model 候选 MUST 与会话页使用相同 Product compatibility 和 managed provider binding；非 Product 候选 MUST 来自 provider-scoped backend catalog，选择结果 MUST 保存 catalog id、runtime model 与 provider profile。
- 同一 `wxid` 且 target 未变化时，只有 route 在 1 天 inactivity TTL 内才 MUST 进入同一 native session 续聊；route 过期、target 变化或用户发送 `/new` 后，下一条普通消息 MUST 创建新 native session。过期只影响 resume decision，MUST NOT 删除旧 native session 或桌面端历史。
- route 的 `lastActivityAtMs` 缺失时 MUST 按 legacy route 兼容处理，并在下一次成功 turn 时补齐。
- 微信创建的 native session MUST 使用 user-visible metadata，并出现在对应 workspace 的会话列表；Codex channel thread MUST NOT 被 helper cleanup 隐藏或归档。
- native turn 完成后系统 MUST 通知 frontend 刷新对应 workspace 的 session catalog。
- 系统 MUST 以 `msgId` 去重；bridge 重推同一消息 MUST NOT 产生重复用户消息。
- 群聊消息 MUST 被忽略（MVP 仅处理私聊）。
- 非文本消息类型（图片 / 文件 / 语音）MVP MAY 回复「暂不支持该消息类型」。

#### Scenario: 用户主动开启新会话

- **WHEN** 已选择 target 的联系人发送 `/new`、`/new-session`、`/新会话` 或 `/重新开始`
- **THEN** 系统 MUST 清除该联系人的 session route 与 pending selection
- **AND** MUST 保留该联系人的 workspace、engine、model 和 provider target
- **AND** 下一条普通消息 MUST 创建新 native session
- **AND** control message MUST NOT 进入 native conversation history

#### Scenario: 长时间不活跃的 route 自动过期

- **WHEN** 联系人的 route 距 `lastActivityAtMs` 已达到 1 天且发送普通消息
- **THEN** 系统 MUST 使用 `continue_session=false` 创建新 native session
- **AND** MUST 保留旧 session 与 workspace history
- **AND** 新 turn 成功后 MUST 更新该联系人的 route `lastActivityAtMs`

#### Scenario: 控制命令始终可发现

- **WHEN** 联系人发送 `/help` 或 `/帮助`
- **THEN** 系统 MUST 返回当前 target 状态与包含 `/new`、`/target`、`/workspace`、`/engine`、`/model`、`/cancel` 的命令提示
- **AND** pending numeric selection 期间发送 `/help` MUST NOT 被当作数字选择失败

#### Scenario: legacy route 仍可读取

- **WHEN** persisted route 缺少 `lastActivityAtMs`
- **THEN** 系统 MUST 成功读取该 route
- **AND** MUST 按未过期 route 处理
- **AND** `/new` 后仍 MUST 保留 route 中可恢复的 selected target

#### Scenario: 重推去重

- **WHEN** bridge 因 retry 重推同一 `msgId` 的消息
- **THEN** session MUST 仅出现一条用户消息

#### Scenario: 同一用户连续消息进入同一 session

- **WHEN** 同一 `wxid` 先后发送两条普通消息且 route 未过期
- **THEN** 两条消息 MUST 路由到同一 session

#### Scenario: 微信创建的会话可见

- **WHEN** 微信 direct text 在绑定 target 上完成首轮 agent turn
- **THEN** 对应 native session MUST 保留完整用户消息与 agent 回复
- **AND** 当前 workspace 的会话列表 MUST 无需重启即可显示该 session

#### Scenario: 切换 execution target

- **WHEN** 用户在微信内通过指令把当前联系人从原 workspace / engine / model 切换到另一个 target
- **THEN** 后续微信消息 MUST 创建新 native session
- **AND** MUST NOT 把新消息续接到旧 target 的 session

#### Scenario: 新联系人没有 target

- **WHEN** 尚未选择 target 的 `wxid` 发送普通文本
- **THEN** 系统 MUST 回复先发送 `/workspace` 的引导
- **AND** MUST NOT 调用任何 engine 或创建 session

#### Scenario: 控制命令不进入会话

- **WHEN** 用户发送 `/workspace` 并用数字回复完成 workspace 选择
- **THEN** 系统 MUST 继续返回 engine/model 选择列表
- **AND** 指令与数字回复 MUST NOT 写入 native conversation history

#### Scenario: 联系人 target 相互隔离

- **WHEN** 联系人 A 完成 target 切换
- **THEN** 联系人 B 的 selected target 与 session route MUST 保持不变
- **AND** 全局微信渠道 settings MUST NOT 被改写
