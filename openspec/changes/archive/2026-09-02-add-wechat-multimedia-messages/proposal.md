# Add WeChat Multimedia Message Transport

## Goal

扩展内置 WeChat bridge 的 inbound/outbound message contract，使 Tencent iLink 的
`text`、`image`、`voice`、`video`、`file` item 不再因为缺少 `text_item` 而被静默丢弃。
其中 image 进入现有 engine image-input contract；远端 image/voice/video/file 按 Tencent
2.4.6 contract 下载并解密到 WeChat managed inbox，再由微信 handler 向 selected engine
提供 validated local attachment path。

## Requirements

- sidecar MUST parse supported iLink media item shapes without panicking or silently dropping the whole message.
- webhook payload MUST remain backward compatible for text-only messages and carry typed media attachments when present.
- image attachments MUST be normalized to `data:image/*;base64,...` when a supported inline payload is available, with a bounded decoded size; remote media MUST be downloaded and decrypted before dispatch.
- remote image/voice/video/file MUST follow the Tencent 2.4.6 CDN URL and AES-128-ECB PKCS#7 contract, including both observed `aes_key` byte representations.
- decrypted media MUST be stored only under the WeChat managed inbound subtree with bounded download, sanitized names, canonical path and regular/non-empty validation.
- every selected engine MUST receive validated local attachment paths through a WeChat-only prompt context; desktop Composer and the shared engine send/history/routing contract MUST remain unchanged.
- WeChat turns MUST inherit the current Doge `defaultAccessMode` instead of omitting `accessMode`; legacy `default` or malformed values MUST degrade to workspace-scoped `current`, while an explicit `read-only` choice remains read-only.
- outbound text behavior, auth, dedupe, session routing, and group-message filtering MUST remain unchanged.
- generated image/video/file replies MUST be uploaded through Tencent iLink CDN before the
  matching `image_item` / `video_item` / `file_item` is sent; a local filesystem path MUST
  NOT be placed directly in the provider payload.
- outbound `media.aes_key` MUST match Tencent 2.4.6: base64 encode the ASCII bytes of the
  32-character lowercase hex AES key, not the raw 16 key bytes.
- outbound text-only replies MUST remain backward compatible, while a reply MAY include
  bounded typed local media artifacts. Outbound voice remains unsupported until a verified
  Tencent voice upload/item contract exists.
- The WeChat outbound adapter MUST materialize current-turn Markdown links returned by any
  selected engine when they resolve to bounded local files under the current workspace or an
  app-managed artifact directory. Successfully materialized links MUST be removed from the
  WeChat text reply so the user receives the actual attachment instead of an inaccessible local
  download link. This behavior MUST NOT be implemented as a Codex-only response contract.
- Linked audio files MUST be sent as generic `file_item` attachments. Doge MUST NOT claim that
  they are Tencent voice messages until a verified voice upload/item contract exists.

## Acceptance Criteria

- text-only inbound regression tests remain green.
- image inbound messages reach `engine_send_message_sync_inner` through its existing `images` argument.
- voice/video/file inbound messages reach the selected session as a readable typed fallback rather than being rejected as missing text.
- malformed or oversized inline image payloads fail readably and do not cause unbounded memory allocation.
- encrypted file/video/voice/image fixtures decrypt byte-exactly; malformed key, unsafe URL, oversized download and path escape fail closed.
- text-only WeChat turns remain byte-for-byte compatible and non-WeChat desktop turns do not receive WeChat attachment context.
- WeChat engine dispatch passes a normalized `accessMode` on every turn, so Codex does not silently fall back to `readOnly` when the application default is writable.
- sidecar payload extraction and main-process webhook parsing have focused Rust tests.
- outbound image/video/file upload payload, AES-128-ECB encryption, CDN response handling,
  AES key encoding, and typed item construction have focused Rust tests.
- relative/absolute local Markdown artifact links from Codex and non-Codex response shapes,
  remote links, path escapes, missing files, oversized files, and linked audio-as-file behavior
  have focused Rust tests.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml --lib wechat`
- `cargo test --manifest-path src-tauri/Cargo.toml --bin wechat-bridge`
- `cargo fmt --all -- --check`
- `git diff --check`
