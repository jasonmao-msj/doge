# 修复 product provisional thread terminal settlement

## Goal

修复 Product Home 首次 Kimi 会话已经产生 assistant reply 与 authoritative `turn/completed`，但无前缀 provisional thread 未 promotion/settle，导致 UI 永久显示“响应中”。

## Requirements

- OpenSpec change：`fix-product-provisional-thread-terminal-settlement`。
- 只以 exact engine/turn ownership 扩展 provisional identity，不根据正文猜 terminal。
- 同一 tick 的 session promotion + terminal 必须结算 canonical 与 provisional alias。
- 保持并发 session、established target 与 turn mismatch 安全边界。

## Acceptance Criteria

- [x] Unprefixed Kimi provisional thread 可按 matching turn promotion。
- [x] Kimi canonical terminal 可同时 settle matching alias。
- [x] Engine/turn mismatch 不发生 rebind。
- [x] OpenSpec/Trellis/ADR 同步。
- [x] L3 focused verification 通过并记录未覆盖 L4。

## Technical Notes

真实证据：`thread/session:skip:non-prefixed-not-active` 后，canonical Kimi terminal 被标记 settled，但原 `01a0366a-2eb2…` 继续产生 `stalled-after-first-delta`，证明 backend terminal 正常、identity promotion owner 丢失。
