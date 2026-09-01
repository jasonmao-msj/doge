# Change: add-wechat-bridge-channel

## Why

用户希望**在微信里直接给 doge 发消息、派任务、收结果**（对齐 OpenClaw 微信接入体验：扫码登录、消息互通）。微信渠道协议层由腾讯 Weixin 团队维护的 iLink provider 承担；Doge 负责随渠道启停自动管理 bundled bridge 的生命周期，不再要求用户手工部署或填写 bridge 连接参数。用户唯一需要完成的授权动作是微信扫码，服务端要求时再输入手机显示的数字验证码。

## What Changes

- 新增 capability `wechat-bridge-channel`：微信个人号渠道，经由 Doge 管理的 bundled bridge provider 收发消息。
- Backend（`src-tauri`）：
  - 内嵌 webhook HTTP server，按 bridge 契约接收入站消息（默认 `webhookPort=18790`、`webhookPath=/webhook/wechat`）。
  - bridge API client：拉取登录二维码、查询登录状态、发送出站消息。
  - session 路由：显式绑定 workspace / engine / model，`wxid → native conversation session` 映射持久化、msgId 去重。
  - 回复回流：聚合 agent 流式输出，超长自动分片后经 bridge 发回。
- Frontend（设置页）：新增「微信渠道」操作区——二维码展示与登录状态、启停开关、扫码授权与数据流说明；bridge 连接参数不向用户暴露。
- 配置与密钥：sidecar 本地 IPC `apiKey` / webhook token 由 Doge 每次启动 runtime 时自动生成并仅驻留进程内存，MUST NOT 依赖 OS vault/keychain 或明文落盘；Tencent iLink login token 由扫码签发并保存在 provider data directory，不存在用户配置的 provider `apiKey` / `proxyUrl`。

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Backend | `src-tauri/src/wechat/**`（新增模块）；settings / secure-store 读写 |
| Frontend | 设置页新增「微信渠道」section（复用 settings sections 既有模式） |
| IPC | 新增少量 command（QR 拉取、登录状态、渠道启停、连通性测试） |
| Bundled dependency | 发布包携带对齐 `@tencent-weixin/openclaw-weixin@2.4.6` 的 Rust iLink bridge；保留 Tencent MIT attribution |
| Out of scope | 多账号（`accounts` map）、图片/文件/语音消息、企业微信与服务号渠道、主动推送通知 |

## Acceptance

1. 用户在设置页开启渠道后，Doge 自动生成内部密钥、启动 bundled bridge provider，并展示微信登录二维码。
2. 微信扫码登录成功后，渠道状态显示「已登录」，掉线有可见状态。
3. 微信向该号发文本消息 → doge 创建/复用对应 session 并由 agent 处理 → 回复经 bridge 发回微信。
4. 同一条微信消息重推（bridge retry）MUST NOT 产生重复 session 消息。
5. 超长回复自动分片发送，分片顺序不乱。
6. 未配置或 bridge 不可达时，渠道降级为可读错误状态，MUST NOT 影响 doge 主流程。
7. 首次启用渠道前 UI MUST 说明微信扫码授权、消息由 Tencent iLink 与 Doge 本机处理，用户确认后方可开启。
8. 用户 MUST NOT 需要填写 bridge 地址、内部 apiKey、webhook host、webhook port、webhook path、device type、provider apiKey 或 proxy URL；bridge provider 缺失/启动失败时，UI MUST 显示可读错误。
9. 设置页 MUST 显示微信消息当前绑定的 workspace、engine 和 model；微信创建或续接的 native session MUST 出现在对应 workspace 的会话列表中。

## Capabilities

- **ADDED** `wechat-bridge-channel`：bridge 契约配置、webhook 接收入站消息、QR 登录流、session 路由与回复回流、失败与安全语义。
