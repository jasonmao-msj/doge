# 修复跨引擎 Claude 续接目标水合

## Goal

确保 Codex → Claude Provider Continuation 成功后，新 Claude Session 首帧即显示并使用冻结的 Claude+Doge+model target；用户普通改同 binding model 不再触发第二次 Continuation。

## Requirements

- OpenSpec change：`fix-provider-continuation-target-hydration`。
- ready 后必须 destination-first：先 hydrate exact target thread，再 select target。
- destination engine 必须显式收敛，不依赖同批 catalog reducer state 的闭包。
- model/effort 只写 target per-thread selection，不污染 source/global active selection。
- catalog refresh 失败仍使用 frozen target id/runtime bounded fallback。
- 不修改 backend operation/create/recovery contract。

## Acceptance Criteria

- [x] ready callback resolve 前 `onSelectThread` 不执行。
- [x] target engine/model/effort 在选择前写入 exact target owner。
- [x] source thread selection 不被 target hydration 覆盖。
- [x] active Claude+Doge thread 同 binding model click 不请求 Continuation。
- [x] L3 focused verification 通过，debug Desktop 真实 Codex → Claude → normal send 通过。

## Technical Notes

证据中的两条 continuation SQLite operation 已 `ready`；根因是 frontend ready 后 navigation/hydration ordering，而不是 Claude bootstrap 或 provider rejection。实现复用 `persistComposerSelectionForThread`，禁止新增 timeout/polling/第二份 selection store。
