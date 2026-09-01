# Bundled Tencent Weixin iLink bridge

Doge bundles a native Rust adapter aligned with the Tencent-maintained
`@tencent-weixin/openclaw-weixin@2.4.6` provider (MIT). The adapter source is
`src-tauri/src/bin/wechat_bridge.rs`; its provider identity and npm integrity
are recorded in `manifest.json`.

The release packaging pipeline places the platform executable at:

- `wechat-bridge/<arch>/wechat-bridge.exe` on Windows
- `wechat-bridge/<arch>/wechat-bridge` on macOS/Linux

Doge starts this executable when the WeChat channel is enabled and stops it
when the channel is disabled or the app exits. Users do not install a provider,
configure a bridge address, or supply an API key/proxy URL.

The local bridge implements:

- `GET /health`
- `GET /login/qrcode`
- `GET /login/status`
- `POST /login/verify`
- `POST /message/send`
- inbound delivery to `DOGE_WECHAT_WEBHOOK_URL`

The adapter talks directly to Tencent iLink at
`https://ilinkai.weixin.qq.com`, using QR authorization, `getupdates` long
polling, and `sendmessage`. Login tokens, sync cursors, and peer context tokens
stay in `DOGE_WECHAT_DATA_DIR`; they are not written to ordinary Doge settings.

Only local process wiring is injected through environment variables:
`DOGE_WECHAT_API_KEY`, `DOGE_WECHAT_WEBHOOK_TOKEN`,
`DOGE_WECHAT_WEBHOOK_URL`, and `DOGE_WECHAT_DATA_DIR`. Secrets must not appear
in command-line arguments or logs.

Tencent's license notice is bundled as
`LICENSE.tencent-openclaw-weixin.txt`.
