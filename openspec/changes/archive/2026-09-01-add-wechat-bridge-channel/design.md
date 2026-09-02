# Design: add-wechat-bridge-channel

## Context

- doge 是 Tauri 2 桌面端；bundled sidecar 通过 Tencent iLink outbound long-poll 收消息，因此不需要公网入口。
- OpenClaw 主线当前使用 Tencent Weixin 团队维护的 external plugin `@tencent-weixin/openclaw-weixin@2.4.6`。插件通过 QR 获取 iLink bot token，调用 `getupdates` / `sendmessage`，不要求 provider API key 或 proxy URL。
- Doge 保留本地 bridge HTTP API + localhost webhook 边界，用于隔离 provider 生命周期与应用 session routing；provider 与 Doge 同机运行。

## Decisions

### D1: bridge provider 随 Doge 发布，由 Doge 管理生命周期

doge 只定义 channel contract 和 process lifecycle；微信协议层由发布包携带的 bridge provider 承担。用户不需要填写地址、token 或部署命令。provider 通过资源目录中的固定 executable 发现，并由 Doge 在渠道启用时启动、渠道关闭或应用退出时停止。

**理由**：协议层对抗性高、更新频繁，仍需隔离在 provider 进程中；生命周期内置可以消除用户的部署和配置负担，同时保留 provider 独立替换/升级的边界。

### D1.2: 具体 provider 采用 Tencent Weixin iLink

发布包内置 `wechat-bridge` Rust sidecar，协议对齐 MIT licensed
`@tencent-weixin/openclaw-weixin@2.4.6`：

- QR：`get_bot_qrcode?bot_type=3` + `get_qrcode_status`，覆盖数字验证码与 IDC redirect。
- Runtime：`getupdates` 长轮询、`sendmessage` 文本发送、`notifystart` / `notifystop` 生命周期。
- Headers：`iLink-App-Id=bot`、`iLink-App-ClientVersion=0x00020406`、扫码后使用 `ilink_bot_token`。
- Persistence：provider data directory 保存 token/base URL/account ID、`get_updates_buf` 与 peer `context_token`。

Doge 生成的 `DOGE_WECHAT_API_KEY` 只用于 sidecar 本地 IPC。provider 不读取
`DOGE_WECHAT_PROVIDER_API_KEY` / `DOGE_WECHAT_PROVIDER_PROXY_URL`，用户无需部署远程服务。
sidecar 将 iLink inbound message 转成现有 localhost webhook payload；Doge 主进程仍不直接持有微信 token。

### D1.1: provider 缺失必须 fail-readable

源码仓库可以没有特定平台的 provider binary，但发布包的 packaging pipeline MUST 携带它。开发包或不完整发布包找不到 provider 时，Doge MUST 保持主流程可用，并把渠道置为 `error`，明确提示“微信 bridge 组件未随安装包提供”，不得伪造已登录状态。

### D2: 入站 = doge 内嵌 webhook server

- `src-tauri` 内嵌轻量 HTTP server（仅渠道启用时启动）。
- 默认绑定 `127.0.0.1:18790`，路径 `/webhook/wechat`；内部 bridge API 默认绑定 `127.0.0.1:18789`，这些值由 Doge 管理且不在设置页暴露。
- bridge 与 doge 同机部署，localhost webhook 零网络配置；不支持将 bundled provider 移到其它机器。
- 入站请求 MUST 校验共享密钥（header 或 query token），校验失败 MUST 拒绝且不处理 body。

### D3: 出站 = bridge HTTP API client

- `GET  /login/qrcode`：拉取登录二维码（data URL 或 URL）。
- `GET  /login/status`：登录态轮询（未登录 / 扫码待确认 / 待输入验证码 / 已登录 / 掉线）。
- `POST /login/verify`：仅在 iLink 返回 `need_verifycode` 时提交手机微信显示的数字。
- `POST /message/send`：发送文本（`to=wxid`, `content`）。
- 具体 endpoint 以实现时选定的 bridge 契约为准，client 层做适配隔离，MUST NOT 散落硬编码。Doge 启动 provider 时通过 argv/env 注入内部 API 地址、webhook 地址和自动生成的 secrets。

### D4: session 路由与去重

- 设置页不再提供 workspace / engine / model routing selector；用户在微信内通过 `/target`、`/workspace`、`/engine`、`/model`、`/cancel` 与数字回复选择 execution target。
- `wxid → selected execution target + native conversation sessionId + pending selection` 映射持久化（本地存储），不同联系人互不影响。旧 route target 可作为兼容迁移来源；global channel settings 不再作为新联系人的隐式 target。
- 控制消息在 agent dispatch 前拦截，不进入 native conversation history。workspace → engine → model 完整选择完成后才原子提交 target；同一 wxid 且 target 未变化时进入同一 session 续聊，target 变化时下一条普通消息创建新 session。
- Product-ready 使用与会话页相同的 Product engine/protocol/model compatibility 与 managed provider binding；非 Product 使用 provider-scoped backend catalog，model choice 携带 catalog id、runtime model 与 provider profile。
- 微信触发的 session 使用 `user-visible` metadata。Codex sync collector MUST 保留该 thread，禁止走 helper thread 的 hide/archive cleanup。
- turn durable completion 后 backend emit `wechat://session-updated`；frontend 对当前 workspace 执行 bounded session catalog refresh，使外部创建的会话无需重启即可出现在列表。
- 以 bridge 提供的 `msgId` 去重，bridge retry / 重推 MUST NOT 产生重复用户消息。
- 群消息 MVP MUST 忽略（仅处理私聊），避免误触发。

### D5: 回复回流与分片

- 聚合 agent 流式输出至本轮结束（或静默阈值），再经 bridge 发回；MUST NOT 每个 delta 发一条微信。
- 单条超过安全长度（约 1800 字）自动按序分片；分片失败按序补偿或报告失败。

### D6: 配置与安全

- sidecar 本地 `apiKey` 与 webhook token 在每次 Doge runtime 启动时重新生成，仅驻留 `WechatRuntime` 进程内存并通过 child environment 注入，MUST NOT 依赖 OS vault/keychain 或写入普通配置文件；iLink bot token 只由扫码签发，保存在 provider data directory 且使用最小文件权限，不进入普通 settings。
- webhook token 与 apiKey 分离：一个是 doge→bridge 鉴权，一个是 bridge→doge 鉴权。
- 渠道默认关闭；首次启用 MUST 弹出扫码授权与数据流说明，用户显式确认。

### D7: 多账号（`accounts` map）留接口不实现

配置 schema 预留 accounts 扩展位，MVP 只支持单账号。

## Risks

| 风险 | 缓解 |
| ---- | ---- |
| Tencent iLink contract 变化 | provider adapter 集中在 sidecar；manifest 固定 upstream version/integrity，contract tests 覆盖 headers/payload/status mapping |
| bridge 服务不可用 / 契约分叉 | client 适配层隔离；连通性测试 command；失败降级为可读状态 |
| 热重载或异常退出残留旧 bridge | readiness 同时校验 exact provider/version/integrity 与当前 local API key，禁止仅凭 HTTP 2xx 接入 |
| webhook 端口被占用 | 端口可配；启动失败给可读错误，不影响主流程 |
| 回复风暴（用户高频发消息） | 入站排队 + 每 session 串行处理；MVP 不做并发派单 |
| QR 过期 | 轮询状态 + 过期自动刷新 QR |
| 数字回复对应过期 catalog | pending selection 保存 stable candidate identity；选择时重新校验 workspace/engine/model，失效则要求重新执行对应命令 |

## Rollback

`src-tauri/src/wechat/**` 与设置页 section 为新增独立模块，关闭渠道开关即停用；删除模块即可完全回滚，无既有行为变更。
