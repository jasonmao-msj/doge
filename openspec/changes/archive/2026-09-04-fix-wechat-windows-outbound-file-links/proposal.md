# Proposal: 修复微信 Windows 文件链接传输

## Why

Windows Codex final answer 会把 absolute drive path 渲染为 `/D:/...`。Desktop Markdown 已能打开该形式，但 WeChat outbound adapter 只对 `file://` / `sandbox:` target 去除 drive 前导 `/`，导致 `.pptx` canonicalize 到错误路径并显示“文件不存在或不可读取”。同时 `.md` 未列入 outbound artifact 类型，微信只收到不可访问的本地 link。

## What Changes

- 统一 ordinary Markdown、`file://` 与 `sandbox:` local target 的 path classification；slash-prefixed drive normalization 仅在 Windows 启用，macOS/Linux native absolute path 保持原语义。
- 将 `.md` 映射为 `kind=file` 与 `text/markdown`，复用现有 canonical root、file/size gate 和 iLink CDN upload pipeline。
- 增加 host-neutral relative/native absolute path、Windows `/D:/...` 与 Unix drive-like absolute path 的 focused regression tests。

## Impact

- Affected capability：`wechat-bridge-channel`
- Affected code：`src-tauri/src/wechat/outbound_artifacts.rs`
- 不改变 frontend、engine sync response、IPC payload 或 Tencent upload wire contract。
- macOS/Linux 不套用 Windows drive rewrite；跨平台 runtime smoke 仍由各平台 CI / release 承担。
