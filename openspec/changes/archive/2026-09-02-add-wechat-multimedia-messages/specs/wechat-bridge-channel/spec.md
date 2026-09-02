## ADDED Requirements

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
