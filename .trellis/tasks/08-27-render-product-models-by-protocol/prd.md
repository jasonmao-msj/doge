# 按 API protocol 渲染 Product 模型目录

## Goal

修复 Doge Product 模型目录的 endpoint compatibility：Codex 显示 Responses-compatible models，
Kimi 显示 Chat-Completions-compatible models，Claude 显示 Anthropic Messages models；同一 row
有多 endpoint evidence 时跨 engine 展示。

## Requirements

- OpenSpec change: `render-product-models-by-protocol`。
- 模型 entitlement 仍只能来自 managed `/v1/models`，不得在 Renderer 伪造新 row。
- Native 将 explicit/legacy/fallback compatibility 归一为 canonical API protocol facts。
- Codex/Kimi MUST NOT 因同属 OpenAI-compatible family 而默认共享全部模型；必须保留 endpoint facts。
- K3/Kimi 与 GPT family 按 production 双 endpoint 实测进入 Codex/Kimi。
- Claude 只显示带 Anthropic Messages protocol 的 row；多协议 row 可跨 engine 显示。
- target repair、engine switch、Picker/search 与 send-time validation 必须复用同一 helper。
- 保留 `id` / `model` 分离；不可调用的 engine/model combination 在发送前不可见。

## Acceptance Criteria

- [x] `k3` / `k3-256k` / Kimi family 在 production Responses routes 补齐后同时出现在 Codex/Kimi。
- [x] GPT/OpenAI row 可同时出现在 Codex 与 Kimi。
- [x] Anthropic-only row 只出现在 Claude。
- [x] 三 endpoint row 出现在三种 Product engines。
- [x] unknown/invalid explicit protocol fail closed。
- [x] L3 focused verification 通过，PR 未合并并可供 review。
- [x] `k3` / `k3-256k` / `kimi-for-coding` Responses probes 200，真实 Codex + `k3` turn exit 0。

## Technical Notes

`ProductModelApiProtocolV1` 是 managed Provider API protocol，不是
`engineIds.json.protocolFamily` 的 CLI/stdout protocol。验证覆盖 Rust projection、Tauri DTO、
frontend compatibility/target/Picker consumers、typecheck、target lint 与 contract gates。
