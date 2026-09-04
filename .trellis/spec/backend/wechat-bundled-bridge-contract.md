# WeChat Bundled Bridge Contract

## Scope / Trigger

适用于 `src-tauri/src/wechat/mod.rs`、`src-tauri/src/bin/wechat_bridge.rs`、
`src-tauri/resources/wechat-bridge/**`、`scripts/prepare-wechat-bridge.mjs`、
`src-tauri/tauri.conf.json` 以及设置页微信渠道。该 capability 是 L3 cross-layer
integration：React settings -> Tauri command -> in-memory runtime secrets/process -> local HTTP -> Tencent iLink。

## Signatures

- `update_wechat_channel({ settings })`：UI action 只改变 `enabled` 与首次授权说明 acknowledgement；request schema 中的 legacy routing/bridge/webhook/device fields 仅为 serialized compatibility，backend MUST normalize 为内部 defaults，且不得推导或写回 global execution target。
- `handle_target_control_message(app, wxid, text)`：在 agent dispatch 前消费 `/target`、`/workspace`、`/engine`、`/model`、`/cancel` 与 pending 状态下的数字回复；返回的控制回复不得写入 native conversation history。
- `get_wechat_channel()`：返回 `WechatChannelView` 与可读 provider/listener status。
- `wechat_get_login_qrcode()`：返回 Tencent iLink QR payload 与可选 expiry。
- `GET /login/qrcode` sidecar response：`{ "value": <qr image content>, "expiresAt": <epoch-ms string> }`；Doge parser MUST 直接识别顶层 `value`，同时保留 legacy `qrcode/qrCode/url/dataUrl` compatibility。
- `wechat_get_login_status()`：状态覆盖 `loggedout | awaitingconfirmation | needverification | loggedin | disconnected | error`。
- `wechat_submit_login_verify({ code })`：提交 1-8 位手机微信数字验证码并继续同一 QR login。
- `extract_outbound_media(response)`：只从当前 sync response 的 `images`、typed path collections
  与 `artifacts` 提取 absolute local path，并归一为 `path/kind/mimeType/fileName`；进入发送队列前
  必须与 Markdown-linked artifact 共用 canonical path、allowed root、extension、regular file、non-empty
  与 `<= 8 MiB` validation。
- `materialize_wechat_markdown_artifacts(response_text, workspace_root, app_data_dir)`：只解析当前
  selected engine reply 的 Markdown link；local target canonicalize 后必须位于 current workspace 或
  `generated-images` managed subtree，且为 non-empty regular file、size `<= 8 MiB`。返回清理后的
  text 与 `WechatOutboundMedia { path, kind, mimeType, fileName }`。只有 allowlisted
  image/video/audio/document/archive extension 才可进入该 materializer；source-code link 保持 text。
- `POST /message/send` media request：`{ to, content: "", media: { path, kind, mimeType,
  fileName? } }`；`kind` 只允许 `image | video | file`，voice/audio fail readable。
- `UploadedMedia.aes_key_hex`：保存用于 `getuploadurl.aeskey` 的 32-character lowercase hex
  string；typed item `media.aes_key` 只允许从该 string 的 ASCII bytes 计算 Base64。
- `download_inbound_media(state, source)`：只允许 HTTPS Tencent Weixin CDN `full_url`，或用
  `encrypt_query_param` 构造固定 `/download` URL；response body 逐 chunk 读取且 plaintext/ciphertext
  均不得超过 100 MiB。
- `parse_inbound_aes_key(value)`：兼容 Base64(raw 16 bytes) 与 Base64(32-character hex ASCII)；
  image-level raw hex `aeskey` 优先于 `media.aes_key`。
- `materialize_inbound_prompt(text, attachments)`：只在 WeChat webhook handler 内把 validated
  managed local path 追加到当前 turn；无 path 时必须 byte-for-byte 返回原 text。
- `resolve_wechat_access_mode(default_access_mode)`：微信 turn dispatch 前归一化
  `AppSettings.default_access_mode`；`full-access/current/read-only` 原样保留，legacy `default`、
  空值和异常值 fail bounded 到 workspace-scoped `current`，不得传 `None` 触发
  engine-specific read-only fallback。
- Provider executable：由 `resolve_bundled_bridge(AppHandle)` 从 bundled resources 解析并作为 child process 运行。
- `prepareDevResources()`：同步完成 bundled engines 与 WeChat bridge resource preparation，成功后才允许 spawn `tauri dev`。
- `getHotDevTauriArgs(args)`：保留 caller args，并注入 `build.beforeDevCommand="node scripts/tauri-dev-frontend.mjs"` 的 dev config override。
- `buildRuntimeManifest(source, requestedTarget)`：不下载/解压 artifact 即构造 canonical bundled-engine runtime manifest。
- `isPreparedOutputCurrent(outputDir, expectedRuntime)`：仅当 manifest 完全相同且所有 executable/required file 都是 regular file 时返回 `true`。
- `replaceOutputTree(outputDir, stageRoot, operations?)`：优先 rename；对 `EACCES/EBUSY/EPERM` bounded retry，对 `EACCES/EBUSY/EPERM/EXDEV` copy fallback，失败时恢复 previous output。
- `parseWindowsListeningPids(netstatOutput, port)`：仅返回 local endpoint 等于目标 port 且 state=`LISTENING` 的 PID。
- `terminatePortPids(pids, terminate?)`：先 graceful tree termination；全部失败时立即尝试 force tree termination。
- `filesMatch(source, destination)`：先比较 regular-file size，再并行计算 SHA-256；同尺寸不同内容 MUST 返回 `false`。
- `writeFileIfChanged(path, content)`：exact content 未变化时返回 `false` 且不得改写 mtime。
- `bridgeBuildFingerprint(target, options?)`：SHA-256 覆盖 target、`rustc --version --verbose`、`RUSTFLAGS/CARGO_ENCODED_RUSTFLAGS`、sidecar source、Cargo manifests/lock、build script 与 `.cargo/config.toml`。
- `isPreparedBridgeCurrent(resourceDir, expectedManifest)`：manifest/fingerprint 完全相同且 target executable 是 regular file 时返回 `true`。

## Contracts

内部 endpoints 固定为 `http://127.0.0.1:18789` 与
`http://127.0.0.1:18790/webhook/wechat`。sidecar 启动时接收：

- argv: `--listen 127.0.0.1:18789`
- env: `DOGE_WECHAT_API_KEY`、`DOGE_WECHAT_WEBHOOK_TOKEN`、`DOGE_WECHAT_WEBHOOK_URL`、`DOGE_WECHAT_DATA_DIR`

Provider MUST 实现 `GET /health`、`GET /login/qrcode`、`GET /login/status`、
`POST /login/verify`、`POST /message/send`，并将 direct text inbound JSON POST 到
localhost webhook。`POST /message/send` 的 text-only request MUST 保持既有
`type=1/text_item` payload；携带 outbound image/video/file 时 MUST 先调用
`ilink/bot/getuploadurl`，使用 bounded local file + AES-128-ECB 上传加密内容，
再发送包含 CDN reference 的 typed item。`media.aes_key` MUST 对同一 32-character
lowercase hex AES key 的 ASCII bytes 做 Base64，不得直接编码 raw 16-byte key。
local API MUST 返回 upload/read/provider 错误，不得将媒体失败静默降级为成功的
text-only reply；显式 voice/audio typed artifact 在 verified provider contract 加入前 MUST fail readable。
任意 selected engine 的 Markdown-linked audio MUST 显式标记 `kind=file` 并作为 generic `file_item` 发送，不得伪装成
voice message。成功 materialize 的 local Markdown link MUST 从 WeChat text 删除；失败 link MUST
替换为可读原因，remote/data/anchor link 保持普通 text 且不得触发 filesystem read。
secrets 只能通过 environment
注入，不得进入 argv 或日志。
local API key 与 webhook token MUST 在每次 runtime start 时重新生成、仅驻留
`WechatRuntime` 内存，并在 stop 时清除；MUST NOT 依赖 OS vault/keychain，避免系统
credential store 锁定时阻断自动启动。

Inbound `image_item/voice_item/video_item/file_item` 的 CDN 内容 MUST 对齐 Tencent 2.4.6：
`full_url` 只能使用 HTTPS Tencent Weixin host；缺失时用固定 CDN base +
`/download?encrypted_query_param=<percent-encoded>`。加密内容使用 AES-128-ECB + PKCS#7；
`media.aes_key` MUST 同时兼容 Base64(raw 16 bytes) 和 Base64(32-character hex ASCII)，image
顶层 raw hex `aeskey` 优先。下载 MUST bounded 到单附件 100 MiB，禁止自动 follow redirect。
明文只允许以 sanitized collision-safe name 写入 `DOGE_WECHAT_DATA_DIR/inbound`；sidecar 完成写入后
才可通过 authenticated localhost webhook 暴露 path。

Main process MUST 再次 canonicalize inbound path，并要求其位于 exact
`<settings-parent>/wechat-bridge/inbound`、为 regular non-empty file、size `<= 100 MiB`。
validated attachment path 只在 `wechat_webhook` task 内追加到 current prompt；`<= 8 MiB` image
额外转换为现有 engine `images` data URL。不得修改 desktop Composer payload、
`engine_send_message_sync_inner` signature、普通 history/routing 或任何 non-WeChat caller。

设置页 MUST NOT 显示 workspace / engine / model routing selector。每个联系人必须在微信内通过
`/workspace` -> 数字、`/engine` -> 数字、`/model` -> 数字完成 target 选择；`/target` 查看当前
target，`/cancel` 取消 pending selection。selected target 与 pending selection MUST 按 `wxid`
独立持久化，控制消息 MUST 在 agent dispatch 前消费。新联系人没有完整 target 时，普通文本只能
收到 `/workspace` 引导，不得创建 native session 或隐式使用 global channel settings。

Product-ready 候选 MUST 与普通会话页使用相同的 `projectProductTargetCatalogV1` compatibility：
`codex=openai-responses`、`claude=anthropic-messages`、`kimi=openai-chat-completions`，并使用
canonical managed provider binding 与相同 runtime model normalization。非 Product 候选 MUST
来自 provider-scoped backend catalog，不得从安装诊断用途的 `engineStatuses.models` 构造平行
catalog。Model choice 携带 `providerProfileId` 时 MUST 一并持久化，Runtime MUST 按
`wxid + workspace + engine + providerProfileId + modelCatalogEntryId + model` 复用 native
session；任一 target 字段变化 MUST 创建新 session。Claude/Codex/OpenCode/Kimi/Grok
sync path MUST 将 explicit provider profile 作为 provider-scoped runtime/session authority，
不得回落到 global current provider。
channel 创建的 session metadata MUST 为 `visibility=user-visible`、
`ownerFeature=wechat-channel`。Codex sync collector 只有在 user-visible mode 下 MUST
复用/保留真实 thread，禁止发送 `codex/backgroundThread hide` 或 `thread/archive`。
turn 完成并持久化 route/target metadata 后 MUST emit `wechat://session-updated`
（`workspaceId/sessionId/engine/model`），frontend 仅对匹配的当前 workspace 做一次
bounded catalog refresh。

具体 provider MUST 对齐 MIT licensed `@tencent-weixin/openclaw-weixin@2.4.6`：

- 固定 QR login origin `https://ilinkai.weixin.qq.com` 与 `bot_type=3`。
- headers 使用 `iLink-App-Id: bot`、`iLink-App-ClientVersion: 132102`；扫码后使用 `AuthorizationType: ilink_bot_token`。
- QR 状态映射 MUST 覆盖 `wait`、`scaned`、`need_verifycode`、`scaned_but_redirect`、`confirmed`、`expired`、`verify_code_blocked`、`binded_redirect`。
- runtime 使用 `notifystart`、`getupdates` long poll 与 `sendmessage`；reply MUST 携带 peer 最近的 `context_token`。
- token、base URL、account ID、`get_updates_buf` 与 peer context tokens MUST 原子写入 provider data directory；Unix permission MUST 为 owner-only。
- sidecar MUST NOT 读取或要求 `DOGE_WECHAT_PROVIDER_API_KEY` / `DOGE_WECHAT_PROVIDER_PROXY_URL`；没有这些 env 时 `/health` 仍 MUST ready。
- Doge readiness gate MUST 校验 `/health` 的 exact provider name/version/integrity，并使用当前 local API key 调用 `/login/status`；旧版、未知或不属于当前 Doge 的进程 MUST NOT 被误判为 ready。

发布资源路径为 `wechat-bridge/<arch>/wechat-bridge[.exe]`。manifest MUST 固定
provider name/version/npm integrity，Tencent MIT notice MUST 随资源目录打包。

开发启动脚本 MUST 在调用 `tauri dev` 前完成 bundled engines 与 WeChat bridge
resource preparation，并在 dev config override 中把 `beforeDevCommand` 收敛为只启动
frontend。首次 release sidecar build 不得占用 Tauri 的 `devUrl` readiness timeout；
正式 `beforeBuildCommand` 仍负责 release packaging 的完整资源准备。

bundled-engine preparation MUST 幂等：已有 manifest 与 expected runtime 一致且所有
声明文件完整时，MUST 在 staging/download/extract 前直接返回，不得重写 resource tree，
否则会触发 Tauri build script 重跑和 Windows directory lock。确需更新时，完整 stage
构造成功后才可发布；rename 遇到 transient lock MUST bounded retry，仍失败或跨 filesystem
时 MAY copy complete stage，但 publish 失败 MUST rollback previous output。

Windows dev port cleanup MUST 只处理目标 local port 的 `LISTENING` PID，禁止根据 remote
endpoint 命中浏览器/client process。普通 `taskkill /T` 失败时 MUST 继续尝试
`taskkill /T /F`；两者都失败则 fail readable，不得声称端口已释放。

WeChat sidecar build 完成后的 publish MUST 内容幂等：destination binary 只有在 size 或
SHA-256 不同时才 copy，manifest 只有在 exact serialized content 不同时才 write。
禁止每次 prepare 无条件覆盖 `resources/wechat-bridge`；该目录属于 Tauri build input，
仅 mtime 变化也会使下一次 Cargo build 失效并形成重复 relink loop。
在调用 Cargo 前 MUST 计算 build fingerprint；fingerprint/manifest/target binary 均 current
时直接返回 `already prepared`。source、Cargo dependency definition/lock、toolchain、target 或
rustflags 任一变化 MUST 使 fingerprint 失效并触发 rebuild；不得只用 binary hash 作为
pre-build authority，因为 Windows linker 对同一 source 的 PE bytes 不保证稳定。

## Validation & Error Matrix

| 场景 | 必须行为 |
|---|---|
| 用户首次开启渠道并确认数据流说明 | 在 runtime 内存中生成 local secrets，启动 bundled provider 与 webhook，随后获取 QR；不显示配置表单 |
| OS vault/keychain 锁定或不可用 | 不影响微信渠道启动；内部 local secrets 不访问系统 credential store |
| Tencent iLink 要求数字验证码 | status=`needverification`，UI 仅接受 1-8 位数字并 POST `/login/verify` |
| bundled sidecar 返回顶层 `value` QR payload | Doge MUST 返回 `WechatLoginQrCode` 并展示二维码；不得误报响应格式无效 |
| 新联系人发送普通文本但没有 selected target | 回复先发送 `/workspace` 的引导；不调用 engine、不创建 session |
| 联系人发送 `/workspace` 并依次回复数字 | 按 workspace -> engine -> model 推进，完整选择后原子保存 target；所有控制消息不进入 native history |
| pending selection 收到 `0`、越界数字或普通文本 | 保持 pending，返回数字范围或 `/cancel` 提示；不得下溢、panic 或进入 agent |
| 联系人 A 切换 target | 联系人 B 的 selected target、pending state 与 session route 保持不变 |
| 微信首条消息完成 | route 持久化真实 native sessionId，session catalog 可见，当前 workspace 自动刷新 |
| 同一 wxid 在相同 target 再次发送 | 续接同一 native session，不创建 helper/临时 session |
| workspace / engine / model target 变化 | 后续消息创建新 native session，不续接旧 target |
| 已选 model row 带 providerProfileId | 使用该 exact provider-scoped runtime，并记录 session provider binding；不得采用全局 current provider |
| Product-ready 联系人发送 `/engine` 或 `/model` | 候选遵循会话页相同 protocol compatibility、managed provider binding 与 runtime model normalization |
| 非 Product 联系人发送 `/model` | 聚合 provider-scoped backend catalog，并把 model catalog id、runtime model 与 provider profile 一并保存 |
| pending catalog 候选已失效 | 重新校验当前 workspace/engine/model 后要求重新选择，不提交 stale target |
| provider binary 缺失 | status=`error`，显示“bridge 组件未随安装包提供”，不影响 Doge 主流程 |
| provider spawn/health 失败 | status=`error`，不得提示用户配置 provider credentials |
| 固定端口残留旧版或其它 bridge | exact provider identity / local API key gate 拒绝接入，显示重启 Doge 的可读错误 |
| provider 意外退出 | status=`error`，停止后续 bridge 请求 |
| 用户关闭/应用退出 | abort monitor、终止 child、释放 webhook 端口 |
| 旧配置携带远程 URL/token | backend 忽略连接字段并归一化到 loopback contract |
| token 失效或 long poll 连续失败 | status=`disconnected`，保留主流程并引导重新扫码 |
| 入站 file/video/voice/image 带有效 CDN reference 与 AES key | bounded download、byte-exact decrypt、写入 managed inbox；webhook 只传 canonical local path 和 metadata |
| 入站 `full_url` 非 HTTPS/Tencent host、redirect、malformed key、invalid padding 或 body > 100 MiB | 不落盘、不向 engine 暴露 remote reference；保留可读媒体 fallback，日志不得包含 URL/key |
| webhook attachment path 越界、symlink escape、empty/non-file/oversized | HTTP 400 fail closed，不创建 engine turn |
| 微信 text-only turn | prompt 与现有 text byte-for-byte 一致，`images=None` |
| 微信 turn + writable `defaultAccessMode` | 显式传 `full-access` 或 `current`，Codex 不得因 `accessMode=None` 降级为 `readOnly` |
| 微信 turn + explicit `read-only` | 保持 `read-only`，不得由渠道静默提权 |
| 微信 turn + legacy `default` / malformed access value | 归一为 workspace-scoped `current`，不得变成 unrestricted 或 read-only dead end |
| 普通桌面会话 turn | Composer/send/history/routing contract 不变，不注入 WeChat attachment context |
| 首次 dev 启动需要长时间编译 sidecar | resource preparation 在 spawn Tauri 前运行；不得进入 `devUrl` readiness timeout |
| outbound generated image/video/file path 可读且不超过限制 | 先 `getuploadurl` + AES-128-ECB CDN upload，再发送 typed item；不得直接发送本地路径 |
| outbound media AES key | `getuploadurl.aeskey` 使用 32-character lowercase hex；item `media.aes_key` 为该 hex string ASCII bytes 的 Base64 |
| outbound media path 缺失/过大/CDN 失败 | 返回 contextual error，不发送伪成功的 text-only response |
| outbound voice/audio artifact | 返回 unsupported-media error；不得伪装成 file item |
| 任意 engine reply 链接 workspace 内 `.md/.pptx/.pdf/.zip` | canonicalize + size gate 后返回 `kind=file` artifact；`.md` 使用 `text/markdown`；微信发送真实 `file_item` 并移除 local link |
| Windows engine reply 使用 `/D:/workspace/report.pptx` | 与 `D:/workspace/report.pptx` 同义 normalize 后再 canonicalize；不得拼接成错误的 workspace-relative path |
| macOS/Linux engine reply 使用 native absolute path（包括 drive-like `/D:/...`） | 保持 Unix absolute path 语义，不得套用 Windows drive rewrite；仍须通过 canonical allowed-root gate |
| 任意 engine reply 链接 workspace 内 `.mp4/.mov/.webm` | 返回 `kind=video` artifact；微信发送真实 `video_item` |
| 任意 engine reply 链接 workspace 内 `.wav/.mp3/.m4a` | 保留 audio MIME，但显式 `kind=file`；微信发送 downloadable `file_item`，不得声称 voice |
| 任意 engine reply 链接缺失/空/超限/越界/symlink escape 文件 | 不创建 artifact；link 原位替换为可读失败，不读取或上传越界文件 |
| 任意 engine reply 链接 `.rs/.ts/.tsx` 等 source file | 保留 ordinary Markdown text；不得自动上传 workspace source code |
| 任意 engine structured media 指向 workspace / managed subtree 之外 | 不加入发送队列，并在 reply 中追加可读失败；不得绕过 Markdown artifact 的 allowed-root gate |
| 当前 workspace metadata 不可用 | fail closed，不发送任何 structured/local media，并返回“无法确认当前工作区”的可读附件提示 |
| bundled-engine manifest/声明文件均未变化 | preparation 在下载/解压/staging 前返回 `already prepared`，不得改写 resource mtime 或触发 Rust relink |
| manifest 相同但 executable/required file 缺失 | 判定为 stale，重建完整 stage；不得仅凭 manifest 跳过 |
| Windows final stage rename 返回 `EPERM/EBUSY/EACCES` | bounded retry；仍失败则 copy complete stage，并删除 staging/previous tree |
| stage publish/copy 失败 | 删除 partial output 并恢复 previous output；错误向上传播 |
| 1420 同时有 LISTENING server 与 client/TIME_WAIT rows | 只终止 LISTENING server PID，不触碰 client PID/0 |
| Windows graceful taskkill 返回失败 | 对同一 scoped PID 执行 force tree kill，再检查 IPv4 与 IPv6 均可监听 |
| sidecar source/destination size 与 SHA-256 相同 | 不 copy binary、不改变 destination mtime |
| sidecar binary 同尺寸但 SHA-256 不同 | copy 新 binary；不得按 size-only 误判 current |
| sidecar manifest exact content 相同 | 不 write manifest；后续 Cargo cache 保持有效 |
| sidecar build fingerprint 与 manifest 相同且 executable 存在 | 调用 Cargo 前直接返回 `already prepared` |
| source/Cargo lock/toolchain/target/rustflags 任一变化 | fingerprint mismatch，重新 build 并发布新 manifest |

## Good / Base / Bad Cases

- Good：UI 只展示启停、Tencent iLink QR、登录态和按需验证码；所有 process/network wiring 由 Doge 完成。
- Good：UI 不展示 routing 表单；联系人在微信内用指令和数字选择 target，provider profile 随 model choice 原子持久化，微信 turn 与桌面会话共用 canonical native history/catalog。
- Good：`npm run tauri:dev:hot` 先完成 cold resource build，再启动只负责拉起 frontend 的 Tauri dev lifecycle。
- Good：资源未变化时 `prepare-bundled-engines.mjs` 亚秒级返回，连续 hot start 不重复 relink Rust 全库。
- Good：同一个 `aes_key_hex` 同时进入 `getuploadurl.aeskey`，并通过
  `BASE64.encode(aes_key_hex.as_bytes())` 进入 typed item；image/video/file 共用该规则。
- Good：`[下载 report.pptx](report.pptx)` 在 workspace boundary + size gate 后变为
  `WechatOutboundMedia(kind=file)`，微信收到 CDN-backed `file_item`；该步骤位于 channel adapter，
  不依赖 response 中的 `engine` 值。
- Good：微信 `report.pdf` 先在 sidecar 以 bounded CDN stream 解密到 `wechat-bridge/inbound`，
  main process 二次 canonicalize 后只为该微信 turn 增加 local path；六个 engine 共用既有 sync dispatch。
- Good：sidecar Cargo check 即使执行，unchanged binary/manifest 也不触碰 Tauri resource mtime。
- Base：source checkout 没有当前 target binary 时显示明确 unavailable error；`npm run prepare:wechat-bridge` 生成本机资源。
- Bad：要求用户填写 bridge URL、provider API key/proxy URL，或把 iLink bot token 写入普通 `settings.json`。
- Bad：在设置页要求用户手动选择 workspace / engine / model，或让新联系人继承 global/default target。
- Bad：把 local API key/webhook token 放进 `Command` argv 或日志。
- Bad：只保存 model string，却在 sync send 时使用 global current provider；同名 model 可能被路由到错误 credential/runtime home。
- Bad：在 base `beforeDevCommand` 中串行执行 release sidecar build 后才启动 Vite；Windows cold build 可超过 Tauri 的 180 秒等待窗口。
- Bad：每次 dev start 无条件 rename/copy `resources/bundled-engines/current`，或按 netstat 任意包含 `:1420` 的 row 终止 client process。
- Bad：`BASE64.encode(aes_key)` 直接编码 raw 16-byte key；Tencent 接受 item shape 后，微信客户端仍无法解密媒体预览。
- Bad：扫描回复中的任意 path 并上传，导致普通 source-code citation 被误当成附件发送。
- Bad：把 inbound file path 新增为 shared engine/Composer 字段，导致普通桌面会话 contract 被迫变化。
- Bad：`copyFileSync(source, destination)` 与 `writeFile(manifest)` 无条件执行，造成下一次 sidecar build 永久 cache miss。

## Tests Required

- Sidecar Rust tests：official headers 无 deployment credentials、send payload/context token、
  outbound upload request/AES typed media item、hex-string AES key encoding、QR status、redirect allowlist、session persistence；
  inbound tests MUST 覆盖 raw/hex AES key byte-exact fixture、PKCS#7、Tencent URL allowlist、filename sanitize、bounded body 与 managed write。
- Main Rust tests：ephemeral secret lifecycle、login status mapping、verification code validation、exact health identity、legacy settings normalization、webhook auth/dedupe/session routing、target command parser、无效数字/pending 文本拦截、per-wxid target/pending persistence 与 legacy route fallback、typed media parsing/image size gate、outbound image/video/file artifact mapping 与 voice rejection；WeChat Markdown artifact tests MUST 覆盖 every engine response、relative/native absolute path、Windows-only slash-prefixed drive normalization、Unix drive-like absolute path preservation、`.md` MIME、`kind/mimeType/fileName`、audio-as-file、structured/link dedupe、remote/source link ignore、missing/outside/empty/oversized rejection，以及 structured media 越界和 workspace-unavailable fail-closed。platform-sensitive test fixture MUST 通过 `std::env::temp_dir()` 等 host-native API 构造 absolute path；不得在跨平台 test 中硬编码另一 OS 的 path syntax。
- Inbound main-process tests MUST 覆盖 managed canonical path、path traversal/symlink escape、empty/oversized file、attachment prompt、downloaded image data URL，以及 text-only prompt byte-for-byte compatibility。
- WeChat access regression MUST 覆盖 `full-access/current/read-only` passthrough、legacy `default` 与 malformed fallback，并断言 webhook dispatch 不再传 `None`；桌面 command signature 与 payload mapping 不变。
- Routing regression MUST 覆盖 exact target 复用、provider/model target 变化新建、真实 sessionId 回写、user-visible Codex retention，以及 explicit provider profile 优先于 session/global fallback。
- QR parser regression MUST 使用 bundled sidecar 的 exact `{ value, expiresAt }` payload，并保留 nested/legacy response coverage。
- Vitest：开启后自动取 QR 并经 `qrcode` 渲染、`needverification` 提交数字、设置页不出现 routing selector、session-updated refresh、UI 不暴露 bridge/provider fields、poll cleanup。
- Packaging：`npm run prepare:wechat-bridge` 后 manifest/provider identity、license 与 target executable 均存在。
- Dev startup：cold bridge build 在 `tauri dev` 启动前完成，随后 frontend 与 Tauri app 可正常启动。
- Bundled-engine preparation regression：matching manifest + complete files 返回 current；缺 required file 返回 stale；模拟 final rename `EPERM` 后 copy fallback 产出新树并清理 stage。
- Dev port regression：Windows netstat fixture 只提取目标 LISTENING PID；graceful termination 失败时必须记录并执行 force attempt。
- Sidecar publish regression：相同 binary 返回 match；同尺寸不同内容返回 mismatch；相同 manifest 返回 unchanged 且 next content 才触发 write。
- Sidecar fingerprint regression：相同 inputs 稳定；target/compiler/rustflags 任一变化产生不同 hash；manifest 匹配但 executable 缺失仍不得复用。
- Cross-layer gates：focused Rust/Vitest、`npm run typecheck`、targeted ESLint、`npm run check:runtime-contracts`、OpenSpec strict、rustfmt、`git diff --check`。

## Wrong vs Correct

Wrong:

```rust
let target = resolve_wechat_execution_target(&state, &settings).await?;
apply_execution_target_to_settings(&mut settings, &target);
```

这会在联系人尚未执行 `/workspace` 时写入 global/default target，并让渠道启停错误依赖
workspace 是否存在。

Correct:

```rust
let settings = normalize_settings(request.settings)?;
next.wechat_channel = settings;
// Per-wxid target 只由 handle_target_control_message 写入 WechatMessageLedger。
```

Wrong:

```rust
Command::new(provider).arg("--provider-api-key").arg(api_key).spawn()
```

```json
{
  "beforeDevCommand": "npm run prepare:wechat-bridge && node scripts/tauri-dev-frontend.mjs"
}
```

Correct:

```rust
crate::utils::async_command(provider)
    .arg("--listen").arg("127.0.0.1:18789")
    .env("DOGE_WECHAT_API_KEY", local_api_key)
    .env("DOGE_WECHAT_DATA_DIR", provider_data_dir)
    .spawn()
```

```js
prepareDevResources();
spawnTauri(getHotDevTauriArgs(process.argv.slice(2)));
```

```js
const expected = buildRuntimeManifest(source, requestedTarget);
if (isPreparedOutputCurrent(OUTPUT_DIR, expected)) return;
await replaceOutputTree(OUTPUT_DIR, completeStage);
```

```rust
resolve_engine_provider_profile_id(
    storage_path,
    workspace_id,
    session_id,
    engine,
    settings.provider_profile_id.as_deref(),
)?;
```

Wrong:

```rust
"aes_key": BASE64.encode(aes_key) // raw 16-byte key
```

Correct:

```rust
let aes_key_hex = aes_key.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
"aes_key": BASE64.encode(aes_key_hex.as_bytes())
```
