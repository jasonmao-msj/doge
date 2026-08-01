# Browser Dock Phase 3 Cross-Platform Degraded-Capability Matrix

> **文档性质**：Phase 3 **跨平台降级能力矩阵**（时间快照）。
> **生命周期**：historical contract evidence；对应 change 已归档
> **Date**：2026-06-02
> **Change**：`advance-browser-dock-trusted-observation-and-code-bridge`
> **Archive**：`openspec/changes/archive/2026-06-03-advance-browser-dock-trusted-observation-and-code-bridge/`
> **最后校准**：2026-08-01 仅核对 change 归宿与当前代码入口；未重跑 macOS / Windows / Linux 实机矩阵
> **索引**：[`README.md`](./README.md) · 计划快照 [`../plans/2026-06-01-browser-dock-phase3.md`](../plans/2026-06-01-browser-dock-phase3.md)
> 现网能力以当前 Browser Dock 代码 / OpenSpec 为准；本表保留手测焦点与平台差异叙事。

| Platform | WebView runtime | Capture transport | Visual evidence | Annotation evidence | Action preview |
|---|---|---|---|---|---|
| macOS | WKWebView | `webview_dom` when active renderer matches; `metadata_fallback` on timeout/mismatch | Screenshot ref is metadata-only; OCR/model image payload requires explicit opt-in | Structured text evidence only; stale on URL/title/session/workspace/TTL mismatch | `navigate/reload/scroll` preview + confirmation path; `click/type/select/submit` blocked |
| Windows | WebView2 | Same contract as macOS; runtime availability may degrade before dock launch | Same metadata-only screenshot ref; WebView2 capture may report degraded capability | Same structured text evidence, no annotated image binary by default | Same preview/audit contract; mutating actions blocked |
| Linux | WebKitGTK | Same contract; AppImage/runtime variation may degrade DOM transport | Same metadata-only screenshot ref; visual binary not sent by default | Same structured text evidence; complex iframe/canvas/virtual-list gaps reported | Same preview/audit contract; mutating actions blocked |

Manual check focus:

1. Browser Dock opens and active session is renderer-bound before capture.
2. Stale preview appears after active tab/session/URL/title/workspace mismatch.
3. Capture payload includes observation state, diagnostics, omitted capabilities, and privacy/budget metadata.
4. Visual evidence separates DOM visual clues, screenshot refs, and OCR text.
5. Annotation payload is structured text only.
6. Safe action preview requires confirmation and records before/after audit metadata.
