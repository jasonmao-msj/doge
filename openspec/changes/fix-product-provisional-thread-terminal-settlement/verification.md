# Verification

## Root-cause evidence

- Product Home logical owner：`01a0366a-2eb2-73b3-9ace-782cb259dcee`，engine=`KIMI`，turn=`kimi-turn-4a82bcc5-d012-4d19-86ce-31d88f2302b7`。
- Kimi wire 已记录 `turn.ended`，backend 随后发布 canonical session=`kimi:session_3e26f220-3bd5-4eef-81ad-701c67f50e0b` 与 authoritative `turn/completed`。
- Renderer diagnostics 记录 `thread/session:skip:non-prefixed-not-active`，随后 terminal 只 settlement canonical row；6 秒后旧 logical owner 继续记录 `stalled-after-first-delta` 且 `isProcessing=true`。
- 结论：backend/Provider terminal 正常；prefix-only provisional resolver 阻断 identity promotion，造成 terminal ownership split。

## L3 automated verification

- Verification level：`L3 Cross-layer / High-risk`；最高触发项为 Native session identity promotion 与 foreground terminal settlement。
- `npx vitest run src/features/threads/hooks/useThreads.pendingResolution.test.ts src/features/threads/hooks/useThreadTurnEvents.test.tsx src/features/threads/hooks/useThreadEventHandlers.test.ts src/features/threads/hooks/useThreads.memory-race.integration.test.tsx --reporter=dot`：PASS，4 files / 174 tests。
- `npm run typecheck`：PASS。
- Target ESLint（resolver、turn events、两组 changed tests）：PASS。
- `npm run check:runtime-contracts`、`npm run check:realtime-event-batching`、`npm run perf:realtime:boundary-guard`：PASS。
- `npm run check:engine-capability-matrix`、`npm run check:engine-adapter-registry`：PASS。
- `npm run check:capability-aware-policy-router`：exit 0，保留 repository advisory inventory（482 findings）；本 change 位于既有 identity compatibility boundary。
- `npm run check:docs`、`npm run check:large-files` report mode、current change strict validation、`git diff --check`：PASS。

## Covered regression matrix

- engine-tagged unprefixed Kimi owner + exact turn → resolver returns provisional UUID。
- engine mismatch / turn mismatch → fail closed。
- multiple exact-turn unprefixed owners → active exact owner tie-break。
- session hint promotion + canonical terminal in one `act` → dispatch rename；canonical/provisional 均清 `isProcessing/activeTurnId`。
- Existing prefix-based pending、established target、concurrent session 与 terminal guard suites继续通过。

## Manual verification / L4 residuals

- [x] 2026-08-24 使用 `npm run tauri:dev:hot` 启动包含本 change 的 `target/debug/doge`，重跑 Product Home → Kimi → `hi`；人工目视确认 assistant reply 后立即退出“响应中”，Stop 恢复为 Send，canonical row 单一。
- 未运行全量 `npm run test`、Release build、Windows/Linux/macOS packaging；由后续 PR/CI 或用户明确要求的 release cycle 承担。
