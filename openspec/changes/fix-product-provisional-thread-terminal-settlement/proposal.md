## Why

Product Home 首次发送可能先拥有一个无 engine prefix 的 provisional thread id，随后 Kimi CLI 才发布 `session_*` canonical identity。当前 pending resolver 只识别 `kimi-pending-*`，导致 session promotion 被跳过；`turn/completed` 随后只结算 canonical row，而仍被用户选中的 provisional row 永久保持 `isProcessing=true`，出现“已经回复但仍显示响应中”。

## 目标与边界

- 以 exact `engine + turnId` 识别 product-created unprefixed provisional owner，并在 native session identity 到达时完成 canonical promotion。
- terminal event 紧随 session promotion 到达时，同时结算 canonical thread 与同 turn provisional alias。
- 保持现有 pending-prefix、并发 session、防 established target 偷绑与 late-event forwarding contract。

## 非目标

- 不从 assistant text、`item/completed` 或静默 timeout 推断 turn 完成。
- 不修改 Kimi CLI wire protocol、backend `TurnCompleted` 生成或 product model/provider routing。
- 不放宽缺少 exact turn ownership 的 workspace-level active-thread 猜测。

## What Changes

- 扩展 turn-bound pending resolution：允许 `engineSource` 与目标 engine 一致、尚未使用 canonical engine prefix 的 provisional thread 参与 exact turn match。
- session-id promotion 接受 resolver 返回的 exact turn owner，即使其 id 不是 `kimi-pending-*`。
- terminal alias resolution 覆盖 Kimi/Grok canonical prefixes，确保 same-tick session promotion 后 `turn/completed` 清除两侧 lifecycle state。
- 增加真实失败形态 regression：unprefixed Kimi provisional id、native session hint、2ms 后 terminal completion。

## 技术方案比较

1. **看到 final assistant text 后直接清除 processing**：改动小，但正文是 presentation evidence，不是 terminal authority；tool call、late error 和长 turn 都可能被提前结束，拒绝。
2. **使用 exact `engineSource + turnId` 做 provisional→canonical promotion，并让 terminal 同 turn settle aliases**：复用现有 identity/terminal contract，不猜完成状态；选择此方案。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `kimi-engine-runtime`：Kimi canonical promotion 与 terminal settlement 必须覆盖 product-created unprefixed provisional identity。
- `engine-runtime-identity`：exact turn-bound provisional owner 即使没有 conventional pending prefix，也必须与 canonical native identity 收敛。

## Impact

- Frontend：`threadPendingResolution.ts`、`useThreadTurnEvents.ts` 及相邻 Vitest。
- Contract：OpenSpec delta、Trellis executable identity/terminal contract、multi-CLI foundation calibration。
- Backend/API/DB：无 payload、command 或 schema 变化。

## 验收标准

- Session hint 将 `01a…` + `engineSource=kimi` + matching `turnId` promotion 到 `kimi:session_*`。
- 紧随其后的 `turn/completed` 同时清除 canonical 与 provisional alias 的 `isProcessing/activeTurnId`。
- Engine mismatch、turn mismatch、established canonical target 仍 fail closed，不发生错误 merge。
- Focused Vitest、typecheck、target ESLint、runtime contracts 与 strict OpenSpec validation 通过。
