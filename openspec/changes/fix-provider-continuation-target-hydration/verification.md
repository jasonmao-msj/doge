# Verification

## Evidence

- Desktop SQLite：`15e01049-…`、`d4f8b770-…` 均为 `phase=ready` 且 target 为 `claude:*`，证明 Codex → Claude backend bridge 成功。
- Screenshot：target tab/Continuation metadata 已是 Claude，但 Composer footer 仍显示 Codex `gpt-5.6-sol`。
- 后续手动 Claude model click 打开来源=Claude、目标=Claude 的第二个 Continuation Dialog；说明 stale Composer target 触发了错误 immutable-binding switch path。
- 第二次失败未产生新的 continuation operation row，符合 control-only target source 在 preparation 前/中 fail closed，而非第一次 bridge 未创建 target。

## L3 verification

- Focused frontend：5 files / 108 tests PASS；新增 error regression 后相关 3 files / 88 tests PASS。
- `npm run typecheck`、target ESLint PASS。
- `npm run check:runtime-contracts`、`npm run check:engine-capability-matrix`、`npm run check:engine-adapter-registry` PASS。
- `npm run check:capability-aware-policy-router` exit 0，advisory inventory 476 findings；本 change 未扩 engine registry/capability。
- `cargo test --manifest-path src-tauri/Cargo.toml native_continuation --lib`：17 tests PASS；`cargo check --manifest-path src-tauri/Cargo.toml --lib` PASS，保留 existing warnings。
- `npm run doctor:strict`、`npm run check:docs`、`npm run check:large-files` report mode、OpenSpec strict validation、`git diff --check` PASS。

## Manual debug App smoke

- [x] 以 `npx tauri build --debug --bundles app --no-sign --features account-convenience` 生成 exact-source `/src-tauri/target/debug/bundle/macos/doge.app`；未覆盖 `/Applications/doge.app`。
- [x] 从 Codex source `hi` 选择 Claude + `claude-opus-4-8`；operation `f7fdbd50-9dd6-4392-890c-0ccfa3249b00` 进入 `ready`，target=`claude:527ebedb-d068-428f-9829-a3a769dd9c18`。
- [x] target 首帧 tab=`Claude · 继续：hi`、footer=`Claude · claude-opus-4-8`；未出现来源 Codex `gpt-5.6-sol` residue。
- [x] 普通发送 `Reply with exactly DOGE_CONTINUATION_OK.` 未打开第二个 Continuation Dialog；Claude 返回 assistant response，Composer 从 `waiting` 收敛为 `ready`。

## L4 residual

- 未运行全量 `npm run test` / `cargo test`、Windows/Linux packaging 或正式签名 Release；交由 PR CI/Release gate。

## Break-loop analysis

### 1. Root Cause Category

- **B · Cross-Layer Contract**：backend `ready`、catalog reload、React active engine、per-thread Composer store 与 navigation 的顺序未形成一个 awaited contract。
- **E · Implicit Assumption**：代码假设 `await catalog reload` 后当前 callback closure 已包含新 row，也假设 target callback 调用时 target 已成为 active owner；两项在 React batched update 下都不成立。

### 2. Why the existing behavior escaped

- Unit tests分别证明 continuation creation、target callback payload 与 thread selection，但没有用 deferred Promise 断言 callback resolve-before-select。
- ready callback 同时写 explicit target key 与 source-scoped global setter；mock 中二者都成功，真实 active owner race 才暴露串台。

### 3. Prevention Mechanisms

| Priority | Mechanism | Action | Status |
|---|---|---|---|
| P0 | Architecture | destination-first awaited hydration；target write只收 exact owner | DONE |
| P0 | Tests | deferred hydration blocks navigation；same-binding model不续接 | DONE |
| P1 | Code-spec | Native continuation executable hydration contract | DONE |
| P1 | Thinking guide | 新 entity mutation 后“先 hydrate、后导航”检查项 | DONE |

### 4. Systematic Expansion

- 相同风险存在于 fork/recovery/create-session 后的“先选择、后补 metadata”路径；本 change 不顺手修改，但后续 review 应用相同 exact-owner ordering 检查。
- Catalog request completion 与 React projection visibility必须分域；需要 target truth 时直接使用 frozen result payload，不从刚 dispatch 的 collection 反推。
