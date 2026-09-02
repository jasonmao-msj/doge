## Context

现有 bundled WeChat bridge 只稳定处理 `text_item`，而 Tencent iLink 的
`image_item`、`voice_item`、`video_item` 与 `file_item` 通过 CDN reference 传输。
这些 reference 需要在 sidecar 内完成 URL validation、AES-128-ECB 解密或加密上传，不能直接交给
engine，也不能把本机路径原样发给微信客户端。

主进程已经拥有统一的 `engine_send_message_sync_inner(...)` selected-engine boundary 和 Codex
generated-image history reconciliation。该变更需要复用这些边界，同时保持普通 Desktop Composer、
history 与 routing contract 不变。详细行为要求见
`specs/wechat-bridge-channel/spec.md`。

## Goals / Non-Goals

**Goals:**

- 为 inbound image/voice/video/file 建立 bounded CDN download、decrypt、managed persistence 与
  selected-engine dispatch 链路。
- 为 outbound image/video/file 建立 local artifact validation、CDN encryption/upload 与 typed item
  链路，并让所有 engine reply 共用同一 Markdown artifact materializer。
- 将微信 turn 的 access mode 显式绑定到当前 `AppSettings.default_access_mode`，避免 Codex 因
  `None` 隐式退回 read-only。
- 用 executable code-spec 和 focused regression 锁定 payload、path、crypto 与 desktop isolation。

**Non-Goals:**

- 不修改 Desktop Composer 或 shared engine send signature。
- 不实现 outbound Tencent voice message；普通音频只作为 generic `file_item`。
- 不把普通 source-code link 自动上传为附件。
- 不宣称 Doge 的 8 MiB outbound policy 是 Tencent iLink 官方服务端上限；provider 公开 contract
  未声明该硬上限。

## Decisions

### 1. CDN crypto 与网络访问归 sidecar 所有

`src-tauri/src/bin/wechat_bridge.rs` 负责解析 Tencent item、限制 CDN host/redirect、执行
AES-128-ECB + PKCS#7、调用 `getuploadurl` 并发送 typed item。主进程只与 localhost bridge API
交换 validated local path 和 typed metadata。

选择该方案是因为 iLink token、signed CDN reference 与 byte-level key representation 都属于
provider adapter。替代方案是把 CDN 流程放进 Tauri 主进程，但会让 provider-private contract
扩散到 shared engine orchestration，并扩大 secret/logging 风险。

### 2. Inbound 文件先落 WeChat managed inbox，再二次校验

sidecar 只把解密后的 non-empty regular file 写入 `DOGE_WECHAT_DATA_DIR/inbound`，单附件最多
100 MiB。webhook 到达主进程后再次 canonicalize，并要求 path 位于 exact managed subtree；只有
当前微信 turn 会获得 local attachment prompt。小于等于 8 MiB 的图片额外进入既有 engine
`images` argument。

双重校验用于处理 localhost webhook boundary 被误用、symlink/path traversal 和文件在两个阶段间
变化的情况。直接把 CDN URL 或未校验 path 传给 engine 无法满足 fail-closed 要求。

### 3. Outbound artifact materialization 位于 WeChat adapter

`src-tauri/src/wechat/outbound_artifacts.rs` 解析 current-turn Markdown links，将 workspace 或
app-managed subtree 内的 allowlisted local file 归一为 `WechatOutboundMedia`。structured artifacts
与 Markdown artifacts 经过同一 canonical path、root、extension、regular-file、non-empty 和
8 MiB bounded policy 后去重，再交给 sidecar 上传。

该能力不能放在 Codex-only response contract：Claude、Codex、OpenCode、Kimi、Grok、Gemini
都通过同一个 sync reply boundary 返回文本。Codex 仅保留 generated image history reconciliation，
负责把 provider-private image 变成 structured path；实际上传仍由 WeChat adapter 统一完成。

### 4. AES key representation 按 wire bytes 分别建模

上传使用随机 16-byte AES key；`getuploadurl.aeskey` 使用其 32-character lowercase hex string，
而 typed item 的 `media.aes_key` 是该 hex string ASCII bytes 的 Base64。测试使用独立 expected
fixture 做 byte-exact 断言，避免 production 与 test 从同一错误假设推导结果。

### 5. 微信 turn 显式 snapshot access mode

webhook dispatch 前读取当前 `AppSettings.default_access_mode`。`full-access`、`current`、
`read-only` 原样传入；legacy `default`、空值与 malformed value 收敛到 workspace-scoped
`current`。该值只作为微信调用 `engine_send_message_sync_inner(...)` 的已有参数传入，不增加 shared
signature，也不改变桌面会话的 per-session selection。

## Risks / Trade-offs

- [Risk] 当前 upload/download crypto 会让明文和密文同时驻留内存，接近 size ceiling 时增加 RSS
  → 维持 outbound 8 MiB、inbound 100 MiB bounded policy；未来提高 outbound ceiling 前先改成
  bounded streaming 或给出经过测量的 memory budget。
- [Risk] Tencent iLink 未公开 outbound hard size limit，服务端可能对不同媒体采用不同阈值
  → Doge 的 8 MiB 明确作为本地 policy；CDN/getuploadurl rejection 原样转成 readable failure，
  不伪装发送成功。
- [Risk] Markdown parser 误把 source citation 当附件上传
  → 只接受 allowlisted media/document/archive extension，并执行 exact root 与 canonical path gate。
- [Risk] Provider 接受 payload 但微信客户端无法解密
  → 对 AES key、plaintext/ciphertext size 和 typed item shape 做 byte-exact focused tests；真实设备
  smoke 仍作为未覆盖项记录。
- [Risk] 微信附件逻辑污染普通桌面会话
  → attachment prompt、Codex reconciliation 与 access-mode snapshot 都由 `owner_feature ==
  "wechat-channel"` 或 webhook owner 限定，并保留 text-only/desktop isolation regression。

## Migration Plan

1. 发布新的 bundled `wechat-bridge` binary 与 Tauri backend；不迁移现有 settings schema。
2. 旧登录 session、routing 与 text-only payload 保持兼容；新媒体字段均为 optional。
3. 回滚时可同时回退 sidecar 与主进程改动，managed inbox 中已下载文件不参与 session authority，
   不需要数据回滚。
