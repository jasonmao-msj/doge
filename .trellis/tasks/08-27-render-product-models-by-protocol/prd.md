# 按 API protocol 渲染 Product 模型目录

## Goal

从最新 `origin/main` 修复 Doge Product 模型目录：Codex 与 Kimi 共享
OpenAI-compatible models，Claude 展示上游支持 Anthropic Messages 的 models；用户可在 Codex
中选择并发送 Kimi family model。

## Requirements

- OpenSpec change: `render-product-models-by-protocol`。
- 模型 entitlement 仍只能来自 managed `/v1/models`，不得在 Renderer 伪造新 row。
- Native 将 explicit/legacy/fallback compatibility 归一为 canonical API protocol facts。
- Codex/Kimi 的同一 catalog snapshot 必须产生相同模型列表和顺序。
- Claude 只显示带 Anthropic protocol 的 row；双协议 row 可同时显示。
- target repair、engine switch、Picker/search 与 send-time validation 必须复用同一 helper。
- 保留 `id` / `model` 分离，Codex 选择 Kimi model 时发送 exact runtime model。

## Acceptance Criteria

- [x] `kimi-for-coding`（或等价 upstream Kimi row）出现在 Codex 与 Kimi。
- [x] GPT/OpenAI row 出现在 Codex 与 Kimi。
- [x] Anthropic-only row 只出现在 Claude。
- [x] 双协议 row 出现在三种 Product engines。
- [x] unknown/invalid explicit protocol fail closed。
- [ ] L3 focused verification 通过，PR 未合并并可供 review。

## Technical Notes

`ProductModelApiProtocolV1` 是 managed Provider API protocol，不是
`engineIds.json.protocolFamily` 的 CLI/stdout protocol。验证覆盖 Rust projection、Tauri DTO、
frontend compatibility/target/Picker consumers、typecheck、target lint 与 contract gates。
