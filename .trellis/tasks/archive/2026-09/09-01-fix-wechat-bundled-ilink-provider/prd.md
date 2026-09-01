# 修复微信 Bundled iLink Provider

## Goal

修复 `add-wechat-bridge-channel` 当前错误采用 remote proxy adapter 的问题，改为随 Doge 发布、开启渠道即自动运行的腾讯官方 Weixin iLink provider。用户只需微信扫码授权，不填写 bridge、API key、proxy URL 或 webhook 配置。

关联 OpenSpec change：`add-wechat-bridge-channel`。

## Requirements

- provider contract 对齐 `@tencent-weixin/openclaw-weixin@2.4.6`，固定使用 Tencent iLink API。
- Rust sidecar 自包含 QR login、验证码、IDC redirect、credential/sync cursor 持久化、`getupdates` 长轮询与 `sendmessage` 文本发送。
- Doge 开启渠道时自动启动 sidecar，关闭或退出时停止；Windows、macOS、Linux 共用纯 Rust 实现。
- 登录 token 不进入普通 settings；sidecar data directory 中的 credential 文件采用最小权限并通过原子替换写入。
- 入站 iLink message 转换成现有本地 webhook contract，保留 session 路由、去重和回复分片。
- workspace / engine / model 不在设置页手动配置；微信联系人通过显式 slash command 与数字回复选择，target 和 pending state 按 `wxid` 隔离持久化。
- 控制消息不得进入 native conversation history；未选择 target 的普通消息只返回引导，不得隐式使用全局默认值。
- UI 支持扫码链接转二维码，并在服务端要求时提交手机微信显示的数字验证码。
- 保留腾讯 MIT license attribution；不得伪造外部 provider credentials。

## Acceptance Criteria

- [ ] 未设置任何 `DOGE_WECHAT_PROVIDER_*` 环境变量时，`/health` 返回 ready。
- [ ] 开启渠道后可获取并显示 Tencent iLink QR，无配置表单。
- [ ] `wait`、`scaned`、`need_verifycode`、`scaned_but_redirect`、`confirmed`、`expired` 状态均有确定映射。
- [ ] 扫码确认后 token/base URL/account ID 持久化，sidecar 重启后自动恢复登录与消息监听。
- [ ] `getupdates` cursor 持久化；重复 message ID 不会触发重复 Doge turn。
- [ ] 文本回复通过 `sendmessage` 携带最近的 `context_token`。
- [ ] `/workspace` → `/engine` → `/model` 可完成联系人 target 选择，`/target` 可查看，`/cancel` 可取消；切换后下一条普通消息创建新 session。
- [ ] 设置页不再展示 workspace / engine / model selector。
- [ ] L3 focused verification 通过；真实设备扫码/收发 smoke 的覆盖状态明确报告。

## Technical Notes

- Upstream provider：`@tencent-weixin/openclaw-weixin@2.4.6`，MIT，integrity `sha512-qw9k3PLTiMWGNjjsknHgcTManH1w4j+Ji1ArWIaYLKCq3aFRsVwcqnPi127bvOoVMJGW4dbyJ8NECEMgoO+iRw==`。
- iLink fixed login endpoint：`https://ilinkai.weixin.qq.com`，`bot_type=3`。
- Runtime API uses `iLink-App-Id: bot`、client version `0x00020406`、`AuthorizationType: ilink_bot_token`。
- MVP 继续只处理 direct text messages；媒体和多账号不在本次范围。
