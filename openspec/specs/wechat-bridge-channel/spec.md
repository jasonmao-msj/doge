# wechat-bridge-channel Specification

## Purpose

定义 Doge 内置 Tencent Weixin iLink bridge 的渠道配置、自动生命周期、扫码登录、联系人级会话目标选择、消息路由与故障隔离契约。

## Requirements

### Requirement: 渠道配置 MUST 对齐 bridge 契约并使用安全存储

系统 MUST 提供微信渠道配置，字段与 bridge 契约对齐：

- bridge API 地址（默认 `http://127.0.0.1:18789`）、webhook host/port/path（默认 `127.0.0.1:18790/webhook/wechat`）和 `deviceType=ipad` 由 Doge 内部管理，不得要求用户填写。
- sidecar 本地 `apiKey` / webhook token：Doge 每次启动 runtime 时自动生成并仅驻留进程内存，MUST NOT 依赖 OS vault/keychain 或写入普通配置文件；停止 runtime 后 MUST 清除。
- Tencent iLink bot token：只允许由微信扫码签发，MUST 保存在 provider data directory 且使用最小文件权限，MUST NOT 进入普通 settings。
- bundled bridge provider executable：MUST 从发布资源中解析，Doge MUST 在启用时启动并在关闭/退出时停止。
- 渠道 MUST 默认关闭；schema MAY 预留多账号扩展位，MVP MUST NOT 实现多账号。

#### Scenario: provider 缺失时渠道处于可读错误态

- **WHEN** 安装包没有 bundled bridge provider executable
- **THEN** 渠道状态 MUST 为「bridge 组件未提供」类错误
- **AND** MUST NOT 启动 webhook server 或发起 bridge 请求

#### Scenario: 开启渠道自动启动 provider

- **WHEN** 用户通过设置页确认 Tencent iLink 授权与数据流说明并开启渠道
- **THEN** Doge MUST 自动生成缺失 secrets、启动 bundled bridge provider、再启动 webhook server
- **AND** 用户 MUST NOT 填写 bridge 地址、apiKey 或 webhook 配置

#### Scenario: 无 provider deployment credentials

- **WHEN** bundled sidecar 启动且环境中不存在 `DOGE_WECHAT_PROVIDER_API_KEY` / `DOGE_WECHAT_PROVIDER_PROXY_URL`
- **THEN** `/health` MUST 返回 ready
- **AND** 用户 MUST 能直接发起 Tencent iLink QR login

#### Scenario: 残留旧 bridge 不得被误判为 ready

- **WHEN** localhost bridge 端口由旧版、未知 provider 或不持有当前 local API key 的进程占用
- **THEN** Doge MUST 拒绝将该进程判定为 ready
- **AND** 渠道 MUST 显示可读的重启提示，MUST NOT 继续请求旧 provider 的 QR API

### Requirement: webhook server MUST 校验鉴权并可安全启停

渠道启用时系统 MUST 启动内嵌 HTTP server 接收入站消息：

- 固定绑定 `127.0.0.1:18790`，路径 `/webhook/wechat`；host / port / path 由 Doge 内部管理，MUST NOT 暴露为用户配置。
- 每个入站请求 MUST 校验 webhook token；校验失败 MUST 拒绝且 MUST NOT 解析 body。
- 端口占用等启动失败 MUST 呈现可读错误状态，MUST NOT 影响 doge 主流程。
- bundled provider 启动失败或意外退出 MUST 呈现可读错误状态，MUST NOT 影响 doge 主流程。
- 渠道关闭或应用退出时 provider 和 server MUST 停止并释放端口。

#### Scenario: token 校验失败拒绝请求

- **WHEN** 入站请求缺少或携带错误 webhook token
- **THEN** 系统 MUST 返回鉴权失败
- **AND** MUST NOT 创建消息或 session

#### Scenario: 端口被占用

- **WHEN** 配置的 `webhookPort` 已被占用
- **THEN** 渠道状态 MUST 显示可读错误（提示端口占用）
- **AND** doge 其余功能 MUST 不受影响

### Requirement: QR 登录流 MUST 可扫码、可轮询、可刷新

系统 MUST 经 bridge API 提供登录流：

- 拉取登录二维码并在设置页展示。
- 轮询登录状态，状态机 MUST 覆盖：未登录 / 扫码待确认 / 待输入数字验证码 / 已登录 / 掉线。
- 二维码过期 MUST 自动或手动刷新。
- 登录态变化 MUST 在 UI 可见。

#### Scenario: 扫码成功

- **WHEN** 用户用微信扫码并确认
- **THEN** 渠道状态 MUST 变为「已登录」
- **AND** 后续入站消息 MUST 进入正常路由

#### Scenario: 登录需要数字验证码

- **WHEN** Tencent iLink 返回 `need_verifycode`
- **THEN** UI MUST 提示用户输入手机微信显示的数字
- **AND** Doge MUST 经本地 bridge 提交验证码并继续同一登录会话

#### Scenario: 掉线可见

- **WHEN** bridge 报告登录态失效
- **THEN** UI MUST 显示「掉线」并引导重新扫码

### Requirement: 入站消息 MUST 路由到稳定 session 且去重

- 设置页 MUST NOT 要求用户选择 workspace、engine 或 model；bridge 地址、内部密钥与 webhook wiring 仍 MUST 由 Doge 自动管理。
- 系统 MUST 在微信内支持 `/target`、`/workspace`、`/engine`、`/model`、`/cancel` 与数字回复完成 target 查看、选择和取消。控制消息 MUST 在 agent dispatch 前消费，MUST NOT 进入 native conversation history。
- 系统 MUST 按 `wxid` 独立持久化 selected execution target、pending selection 与 session route；一个联系人切换 target MUST NOT 修改全局 channel settings 或其他联系人的 target。
- 新联系人尚未选择完整 target 时，普通消息 MUST 返回选择引导，MUST NOT 使用任意 global/default target 创建 session。
- Product-ready 的 engine/model 候选 MUST 与会话页使用相同 Product compatibility 和 managed provider binding；非 Product 候选 MUST 来自 provider-scoped backend catalog，选择结果 MUST 保存 catalog id、runtime model 与 provider profile。
- 同一 `wxid` 且 target 未变化时 MUST 进入同一 native session 续聊，target 变化时下一条普通消息 MUST 创建新 session。
- 微信创建的 native session MUST 使用 user-visible metadata，并出现在对应 workspace 的会话列表；Codex channel thread MUST NOT 被 helper cleanup 隐藏或归档。
- native turn 完成后系统 MUST 通知 frontend 刷新对应 workspace 的 session catalog。
- 系统 MUST 以 `msgId` 去重；bridge 重推同一消息 MUST NOT 产生重复用户消息。
- 群聊消息 MUST 被忽略（MVP 仅处理私聊）。
- 非文本消息类型（图片 / 文件 / 语音）MVP MAY 回复「暂不支持该消息类型」。

#### Scenario: 重推去重

- **WHEN** bridge 因 retry 重推同一 `msgId` 的消息
- **THEN** session MUST 仅出现一条用户消息

#### Scenario: 同一用户连续消息进入同一 session

- **WHEN** 同一 `wxid` 先后发送两条消息
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

### Requirement: 回复回流 MUST 聚合流式输出并按序分片

- 系统 MUST 聚合 agent 流式输出至本轮结束（或达到静默阈值）后再发送，MUST NOT 每个 delta 发一条微信消息。
- 单条回复超过安全长度（约 1800 字）MUST 自动按序分片发送；任一分片失败 MUST 报告失败状态。

#### Scenario: 长回复分片

- **WHEN** agent 本轮回复超过安全长度
- **THEN** 系统 MUST 拆分为多条消息按原顺序经 bridge 发出

#### Scenario: 流式中间态不发微信

- **WHEN** agent 正在流式输出中
- **THEN** 微信侧 MUST NOT 收到中间态消息

### Requirement: 启用渠道前 MUST 展示扫码授权与数据流说明

- 首次启用渠道时，UI MUST 说明：渠道使用 Tencent Weixin iLink 扫码授权，消息由 Tencent iLink 与本机 Doge 处理，登录 token 保存在本机 provider data directory。
- 用户 MUST 显式确认后方可启用；确认记录 MUST 持久化，再次启用不重复打扰。

#### Scenario: 未确认不启用

- **WHEN** 用户打开启用开关但尚未确认 Tencent iLink 授权与数据流说明
- **THEN** 渠道 MUST 保持未启用状态
- **AND** UI MUST 先展示 Tencent iLink 授权与数据流确认

### Requirement: 渠道故障 MUST 降级为可读状态

bridge 不可达、鉴权失败或登录态异常时：

- 渠道 MUST 进入可读错误状态（中文用户可读文案），MUST NOT 暴露原始 HTTP body 或堆栈。
- 故障 MUST 隔离在渠道模块内，MUST NOT 阻断或崩溃 doge 主流程。

#### Scenario: bridge 不可达

- **WHEN** bridge 地址无法连接
- **THEN** 渠道状态 MUST 显示「bridge 连接失败」类友好文案
- **AND** doge 其余功能 MUST 正常运行

### Requirement: Inbound iLink media MUST be preserved across the bridge

The bundled sidecar MUST parse `item_list` entries for `text`, `image`, `voice`,
`file`, and `video` without dropping an otherwise valid direct message merely
because it has no `text_item`.

#### Scenario: image item reaches the selected engine

- **WHEN** Tencent iLink sends an `image_item` with a supported inline image payload
- **THEN** the sidecar MUST emit a typed `attachments` entry and `images` data URL
- **AND** Doge MUST pass the validated image data URL through the existing engine `images` contract

#### Scenario: text and image item are combined

- **WHEN** one iLink message contains text and image items
- **THEN** Doge MUST preserve the text and image in the same inbound turn

#### Scenario: encrypted inbound file reaches the selected engine

- **WHEN** Tencent iLink sends an image, voice, file, or video item with `full_url` or `encrypt_query_param`
- **THEN** the sidecar MUST download at most 100 MiB from an HTTPS Tencent Weixin CDN URL
- **AND** it MUST decode `media.aes_key` as either Base64(raw 16 bytes) or Base64(32-character hex ASCII), then decrypt AES-128-ECB with PKCS#7 padding
- **AND** image-level raw hex `aeskey` MUST take precedence for image decryption
- **AND** the plaintext MUST be written under `DOGE_WECHAT_DATA_DIR/inbound` with a sanitized collision-safe name
- **AND** the webhook MUST carry the canonical local path, MIME type, file name, and actual size

#### Scenario: downloaded attachment is dispatched

- **WHEN** the authenticated webhook contains a local attachment path
- **THEN** Doge MUST canonicalize it and require a regular non-empty file under the exact WeChat managed inbound subtree
- **AND** only the WeChat handler MUST append the validated path to the current user prompt
- **AND** Claude, Codex, OpenCode, Kimi, Grok, and Gemini MUST use the same selected-engine dispatch boundary
- **AND** a downloaded image no larger than 8 MiB MUST also reuse the existing engine `images` argument

#### Scenario: desktop conversation remains isolated

- **WHEN** a user sends any ordinary desktop conversation turn
- **THEN** Doge MUST keep the existing Composer payload, engine send signature, history behavior, and routing unchanged
- **AND** Doge MUST NOT add WeChat attachment context to that turn

#### Scenario: WeChat turn inherits the application access mode

- **WHEN** the authenticated WeChat handler dispatches a turn to any selected engine
- **THEN** Doge MUST snapshot and explicitly pass the current application `defaultAccessMode`
- **AND** `full-access`, `current`, and `read-only` MUST preserve their meanings
- **AND** legacy `default`, empty, or malformed values MUST degrade to workspace-scoped `current` rather than `read-only` or unrestricted access
- **AND** the desktop Composer payload and per-session access selection MUST remain unchanged

#### Scenario: inbound CDN materialization is unsafe or fails

- **WHEN** an AES key is malformed, a `full_url` is not HTTPS or not hosted by Tencent Weixin, a response exceeds 100 MiB, decryption padding is invalid, or a webhook path escapes the managed root
- **THEN** Doge MUST fail closed for the local file
- **AND** the media turn MUST remain readable without exposing the signed URL or AES key in logs or prompt

#### Scenario: invalid image data is received

- **WHEN** an image data URL is malformed or exceeds the bounded payload size
- **THEN** the webhook MUST reject the payload or omit the unsafe inline bytes with a readable error path
- **AND** Doge MUST NOT decode an unbounded image payload

### Requirement: Outbound generated media MUST use the iLink CDN contract

The bundled sidecar MUST accept a bounded local media path for outbound replies.
For image, video, and file media it MUST call `ilink/bot/getuploadurl`, encrypt the
file with AES-128-ECB using the generated 16-byte key, upload the ciphertext to the
returned CDN URL, and send the returned CDN reference in the matching typed item.
The `media.aes_key` field MUST base64 encode the ASCII bytes of the same 32-character
lowercase hex key sent to `getuploadurl.aeskey`; it MUST NOT base64 encode the raw
16 key bytes.

#### Scenario: generated image is returned to WeChat

- **WHEN** the selected engine returns a generated image artifact under the managed
  application image directory
- **THEN** Doge MUST preserve the text reply and pass the artifact path to the bridge
- **AND** the bridge MUST upload it before calling `ilink/bot/sendmessage`
- **AND** WeChat MUST receive an `image_item` containing `media.encrypt_query_param`,
  Tencent-compatible base64 `media.aes_key`, `media.encrypt_type=1`, and the encrypted
  `mid_size`

#### Scenario: generated video or file is returned to WeChat

- **WHEN** the selected engine returns a typed local video or file artifact
- **THEN** Doge MUST pass its path, kind, MIME type, and file name to the bridge
- **AND** the artifact MUST pass the same canonical workspace/app-managed root, extension, regular-file, non-empty, and size validation as Markdown-linked artifacts
- **AND** the bridge MUST upload it through the same bounded CDN pipeline
- **AND** WeChat MUST receive a `video_item` with ciphertext `video_size` or a
  `file_item` with plaintext `len` and the original file name

#### Scenario: current workspace cannot be resolved

- **WHEN** Doge cannot resolve the selected target's current workspace metadata
- **THEN** the WeChat outbound adapter MUST fail closed for all structured and local media
- **AND** the reply MUST include a readable attachment failure instead of uploading an unbounded path

#### Scenario: outbound voice has no verified provider contract

- **WHEN** an outbound artifact is typed as voice/audio
- **THEN** Doge MUST reject it with a readable unsupported-media error
- **AND** Doge MUST NOT mislabel it as a generic file or report successful delivery

#### Scenario: selected engine reply links a generated local document

- **WHEN** the current turn from any selected engine returns a Markdown link to a regular non-empty file under the
  current workspace or an app-managed artifact directory and the file is within the outbound
  media size limit
- **THEN** the WeChat outbound adapter MUST resolve the link to an absolute canonical path and
  create a typed outbound artifact
- **AND** the WeChat bridge MUST send the document as a `file_item` instead of forwarding the
  inaccessible local Markdown download link
- **AND** only a successfully materialized link MUST be removed from the text reply
- **AND** this behavior MUST be identical for Claude, Codex, OpenCode, Kimi, Grok, Gemini, and
  any later engine using the same sync reply boundary

#### Scenario: selected engine reply links a generated local video or audio file

- **WHEN** the current turn from any selected engine returns a valid local video link
- **THEN** Doge MUST classify it as video and send a `video_item`
- **AND WHEN** the link points to an audio file
- **THEN** Doge MUST classify it as a generic downloadable file and send a `file_item`
- **AND** Doge MUST NOT represent that file attachment as a Tencent voice message

#### Scenario: selected engine reply link is unsafe or unavailable

- **WHEN** a local-looking Markdown target is missing, empty, oversized, resolves outside the
  allowed roots, or escapes an allowed root through a symlink
- **THEN** Doge MUST NOT expose it as an outbound artifact
- **AND** the text reply MUST retain a readable attachment failure in place of the unusable link
- **AND WHEN** the target is an HTTP, HTTPS, data, anchor, or other non-local link
- **THEN** Doge MUST leave it as ordinary reply text and MUST NOT read it from the filesystem

#### Scenario: outbound image cannot be read or uploaded

- **WHEN** the artifact path is missing, exceeds the bounded media size, or CDN upload
  returns an error
- **THEN** the bridge MUST return a readable error and MUST NOT send a fake text-only
  success response for that image request

#### Scenario: text-only reply remains compatible

- **WHEN** no outbound media is present
- **THEN** the bridge MUST send the existing `type=1/text_item` payload unchanged
