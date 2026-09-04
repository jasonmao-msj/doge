# 修复微信 Windows 文件链接传输

## Goal

修复 Codex 在 Windows 上返回 slash-prefixed drive Markdown link（例如 `/D:/workspace/report.pptx`）时，微信 outbound adapter 无法读取文件的问题，并让生成的 `.md` 文档作为真实微信文件发送；同时保证 Windows normalization 不改变 macOS/Linux native path 语义。

## Requirements

- 普通 Markdown local target 与 `file://` / `sandbox:` target 使用同一 platform-aware path classification；仅 Windows 启用 drive path normalization。
- macOS/Linux native absolute path 原样进入 `PathBuf`，包括不得把合法的 `/D:/...` Unix absolute path 改写为 relative path。
- `.md` 文件通过现有 canonical root、regular file、non-empty、8 MiB size gate 后映射为 `kind=file`、`text/markdown`。
- 成功 materialize 的 `.md` / `.pptx` link 从微信文本移除，交由现有 iLink CDN `file_item` pipeline 发送。
- link 独占 Markdown bullet 时，不保留空的列表 marker。
- HTTP/source-code/越界/缺失文件的既有 fail-closed 行为不变。
- workspace unavailable structured-media test 必须使用 host-native absolute path，不得用 Windows-only fixture 破坏 macOS/Linux test semantics。
- 不改动当前未提交的微信 session-control 实现。

## Acceptance Criteria

- [x] `/D:/workspace/report.pptx` 在 Windows 上解析为 `D:\workspace\report.pptx`，不再拼成错误路径。
- [x] `.md` 与 `.pptx` 均生成真实 outbound file artifact。
- [x] 回归测试覆盖 slash-prefixed Windows link 与 Markdown MIME。
- [x] host-neutral tests 覆盖 relative/native absolute path，non-Windows test 覆盖 drive-like absolute path 不被改写。
- [x] focused Rust tests、`cargo check --lib`、OpenSpec strict validation、`git diff --check` 通过。
- [x] GitHub Actions run `33630669690` 的 macOS failure 已由 portable fixture 覆盖同一断言。

## Technical Notes

OpenSpec change：`fix-wechat-windows-outbound-file-links`。变更位于 WeChat channel adapter，不改变 engine response 或 frontend Markdown contract。当前开发机仅安装 Windows Rust target；macOS/Linux runtime smoke 必须由对应 native CI / release job 给出，不能由本机结果替代。
