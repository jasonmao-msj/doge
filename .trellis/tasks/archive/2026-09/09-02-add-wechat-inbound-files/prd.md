# 微信文件入站

## Goal

让微信联系人发送的 image / voice / video / file 经 Tencent iLink CDN 下载、解密并进入所选 Doge engine，同时保证普通桌面会话行为不变。

## Requirements

- 对齐 `@tencent-weixin/openclaw-weixin@2.4.6` 的 CDN URL、AES key 双编码与 AES-128-ECB PKCS#7 contract。
- 入站文件只写入 `DOGE_WECHAT_DATA_DIR/inbound`，限制单附件 100 MiB，文件名 sanitize，最终路径 canonicalize。
- 主进程只接受该 managed subtree 内的 regular non-empty file；微信 turn 通过本地附件上下文进入所有 selected engine。
- 小于等于 8 MiB 的入站图片继续复用现有 engine `images` contract。
- 不修改桌面 Composer、普通会话 payload、history 或 engine routing contract。
- 微信 turn 显式继承 Doge `defaultAccessMode`，不再因缺失参数被 Codex 默认降级为只读。

## Acceptance Criteria

- [x] file / video / voice / image 的 encrypted fixture 可 byte-exact 解密并安全落盘。
- [x] malformed key、非 Tencent URL、oversized body 与 path traversal fail closed。
- [x] 微信 attachment prompt 包含 validated local path；text-only prompt byte-for-byte 不变。
- [x] `engine_send_message_sync_inner` 的签名与非微信调用方不变。
- [x] 微信 writable/read-only/legacy access mode 均按 contract 归一化并传入 engine。
- [x] L3 focused Rust tests、`cargo check --lib`、runtime contract、OpenSpec strict、rustfmt 与 diff check 通过。

## Technical Notes

OpenSpec change：`add-wechat-multimedia-messages`。入站 adapter 在 sidecar materialize binary，在微信 webhook handler 组装 prompt；共享 engine boundary 只被调用，不新增 global file field。
