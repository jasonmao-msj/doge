# 启用 managed Codex 生图

## Goal

让 Doge managed Codex 在 macOS/Windows 上自动使用与实际 Codex binary 同版本的 non-Lite model catalog，使 token2api hosted `image_generation` bridge 可用，并复用既有幕布图片渲染链路。

Linked OpenSpec change: `enable-managed-codex-image-generation`

## Requirements

- 只对 `providerProfileId=doge-token-matrix` 生效。
- 每次 managed Codex cold launch 从 exact binary 执行 `debug models --bundled`。
- 完整保留 catalog，仅将 `gpt-5.6-sol/terra/luna.use_responses_lite=false`。
- bounded capture、timeout、strict shape validation、owner-only atomic write。
- 通过 launch-scoped `model_catalog_json` override 注入，不修改用户 `~/.codex`。
- 新用户首次使用和老用户升级后首次使用自动生效。
- catalog materialization 失败必须在 Session/Binding/Turn side effect 前 fail closed。
- 不新增图片成功文案 heuristic；只认 native `image_generation_call` + payload。

## Acceptance Criteria

- [ ] focused Rust tests 覆盖 catalog patch、missing/duplicate/malformed、bound/non-zero、atomic idempotence、managed-only args。
- [ ] managed Codex app-server 真实请求不带 Responses Lite header。
- [ ] token2api 使用记录出现 Doge Managed `按次(图片)` 且一张图片 output。
- [ ] Hot Doge 幕布显示生成中/完成图片卡，history reload 可恢复。
- [ ] local/custom provider 不注入 override；global Codex config 不变。
- [ ] L3 focused checks 和 strict OpenSpec validation 通过。

## Technical Notes

- 复用 `resolve_codex_launch_context` / `build_codex_command_from_launch_context`，确保 `.cmd/.bat/.ps1/.exe/direct` 与真实 launch 一致。
- materialization owner 放在 `src-tauri/src/codex/**`，由 `ensure_codex_session_for_provider` 的 managed path 调用。
- `codex_args` 追加顺序使 managed catalog override 最后生效，避免 project-local config 覆盖。
- Verification level: L3，原因是 provider/engine launch routing、child process、cross-platform atomic file 与真实 remote image capability。
