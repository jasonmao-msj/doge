# Design: 微信跨平台 outbound file link normalization

## Root Cause

`markdown_target_path()` 仅在 target 带 `file://` 或 `sandbox:` scheme 时调用 `windows_uri_path()`。Codex 当前输出的 canonical display link 是 ordinary Markdown target `/D:/...`，因此 `PathBuf` 收到 Windows rooted-without-prefix path，无法定位实际文件。`.md` 又不在 `artifact_type()` allowlist，导致该 link 不进入附件 pipeline。

macOS CI 的 `refuses_structured_media_when_workspace_is_unavailable` 使用硬编码 `C:\\private\\preview.png` 作为 structured media fixture。`Path::is_absolute()` 按 host platform 解释路径；该字符串在 Windows 是 absolute path，在 macOS/Linux 是 relative path，因此 non-Windows test 在进入 workspace-unavailable fail-readable branch 前就丢弃了 fixture。这是 test portability 缺陷，不是应放宽 relative structured media contract 的理由。

## Decision

在 scheme 分类完成后，对所有 local target 统一进入 platform-aware normalization，再构造 `PathBuf`。Windows build 仅对 `/[A-Za-z]:/...` 去除 URI 风格前导 `/`；non-Windows build 原样保留 target，避免把 Unix 上合法的 `/D:/...` absolute path 改写为 relative path。这保持 remote scheme fail-closed，不扩大 allowed root；最终仍由 `fs::canonicalize()` 和 workspace/app-managed root gate 决定是否可发送。

把 `.md` 加入文档 allowlist，MIME 为 `text/markdown`、kind 为 `file`。不引入新的 upload branch，继续复用现有 `file_item` pipeline。

成功 materialize 后，如果原 link 独占 Markdown bullet，则移除只剩 marker 的空行，避免附件已发送时额外产生空列表文本。

## Validation Matrix

| Case | Expected |
|---|---|
| `/D:/workspace/report.pptx` on Windows | normalize to drive-absolute path and materialize file artifact |
| `/D:/workspace/report.md` on Windows | materialize `kind=file`, `mimeType=text/markdown` |
| native absolute path on Windows/macOS/Linux | preserve native semantics and materialize an in-root artifact |
| `/D:/workspace/report.pptx` on macOS/Linux | preserve as Unix absolute path; MUST NOT rewrite to `D:/...` relative path |
| relative `.md` under workspace on any platform | resolve under workspace and materialize file artifact |
| missing/outside/oversized local file | retain readable failure; do not upload |
| HTTP or source-code link | preserve ordinary text; do not read filesystem |
| structured media + workspace unavailable on any host | host-native absolute fixture reaches fail-readable branch; return no media |

## Risk

风险限定在 WeChat Markdown artifact classifier。platform branch 在 compile time 固定，不依赖 runtime OS 猜测；所有新增类型仍经过 existing canonical root 和 size gate，不允许任意 source extension，也不读取 remote link。当前开发机只能实测 Windows target，macOS/Linux native runtime 证据由对应 CI / release smoke 提供。
