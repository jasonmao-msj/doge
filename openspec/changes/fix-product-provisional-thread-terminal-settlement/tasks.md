## 1. Evidence and Contract

- [x] 1.1 **P0 · deps: none** — 输入：截图、Kimi `wire.jsonl`、`leida.json` terminal diagnostics；输出：确认 backend `turn.ended/TurnCompleted` 正常且 frontend 记录 `skip:non-prefixed-not-active`；验证：evidence timestamp/turn/session identity 可一一关联。
- [x] 1.2 **P0 · deps: 1.1** — 输入：`kimi-engine-runtime` 与 `engine-runtime-identity` main specs；输出：proposal/design/spec delta；验证：`openspec validate fix-product-provisional-thread-terminal-settlement --strict --no-interactive`。

## 2. Identity and Terminal Implementation

- [x] 2.1 **P0 · deps: 1.2** — 输入：`threadPendingResolution.ts` 的 engine-tagged unprefixed thread + exact turn；输出：只对 matching `engineSource + activeTurnId` 返回 provisional owner；验证：resolver Good/Bad Vitest。
- [x] 2.2 **P0 · deps: 2.1** — 输入：`useThreadTurnEvents.ts` session hint 与 same-tick canonical terminal；输出：promotion 接受 exact turn owner，Kimi/Grok alias terminal 同时 settle source/canonical；验证：hook regression 断言 rename 与双侧 `markProcessing(false)`。

## 3. Verification and Knowledge Capture

- [x] 3.1 **P1 · deps: 2.1,2.2** — 输入：touched resolver/hook；输出：focused Vitest、typecheck、target ESLint、runtime contracts；验证：全部 PASS，`git diff --check` clean。
- [x] 3.2 **P1 · deps: 3.1** — 输入：已验证实现；输出：Trellis executable contract、foundation ADR calibration、change verification；验证：docs/OpenSpec gates PASS，并记录未覆盖 L4/真实重打包范围。
- [x] 3.3 **P1 · deps: 3.2** — 输入：包含本 change 的新 hot/release build；输出：Product Home → Kimi → short reply 实机 evidence；验证：canonical row 单一且 reply 后立即退出“响应中”。
