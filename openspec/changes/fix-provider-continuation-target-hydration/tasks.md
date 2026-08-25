## 1. Evidence and contract

- [x] 1.1 **P0 · deps: none** — 关联 screenshots、continuation SQLite rows 与 frontend callbacks，确认 backend operation 已 `ready`、错误来自 ready 后 target state race。
- [x] 1.2 **P0 · deps: 1.1** — 定义 destination-first hydration、source-isolation 与 same-binding model contract；strict validate OpenSpec artifacts。

## 2. Frontend implementation

- [x] 2.1 **P0 · deps: 1.2** — `confirmProviderContinuation()` await target hydration before exact thread selection；禁止 fire-and-forget ordering。
- [x] 2.2 **P0 · deps: 2.1** — target hydration 显式收敛 destination engine，并只写 exact target per-thread selection；移除 source/global model mutation。

## 3. Regression and verification

- [x] 3.1 **P0 · deps: 2.1,2.2** — 增加 deferred ordering、target/source state isolation、same-binding model tests。
- [x] 3.2 **P1 · deps: 3.1** — 运行 L3 focused Vitest、typecheck、target ESLint、runtime/capability contracts、OpenSpec/docs gates 与 `git diff --check`。
- [x] 3.3 **P1 · deps: 3.2** — local debug `.app` 目视验证 Codex → Claude 后 Composer 首帧即 Claude target，普通发送不再打开第二个 Continuation Dialog，回复后恢复 ready。
