# Verification — enable-cross-protocol-product-engine-models

Date: 2026-08-30

## Status

**READY FOR DELIVERY。**

本 change 只实现 `Codex + Claude-family model`，不修改 token2api source。

## Upstream capability evidence

- Production `Doge APP` 已保存并启用 `claude-*` prefix / Responses → Anthropic route，priority=`100`，upstream model 保持 raw prefix passthrough。
- Managed `/v1/models` catalog 顺序为 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`claude-opus-4-8`、其余非对话/其他 family rows；Claude row 位于既有 GPT defaults 之后，避免改变 Codex 默认模型。
- Minimal `POST /v1/responses` with `model=claude-opus-4-8` 返回 `status=completed` 与 exact text `OK`。
- Bundled Codex CLI `0.150.0-alpha.8` 使用 managed `CODEX_HOME`、exact `model=claude-opus-4-8` 执行 `codex exec --ephemeral --json`，exit `0`，输出 typed `agent_message=OK` 与 `turn.completed`；未发生 model fallback。
- 所有 evidence 均未在日志、测试或 artifact 中记录 managed secret。

## Cross-layer evidence

```text
token2api Responses route
  -> /v1/models ProductModelWire
  -> compatible_product_api_protocols
  -> ProductModelViewV1.apiProtocols
  -> projectProductTargetCatalogV1
  -> Composer / Panel / Kanban / Shared target consumers
  -> exact Codex ExecutionTarget
  -> ensureProductEngineReadyV1
  -> revision-2 managed Codex config
  -> Codex runtime
```

- metadata absent 的 Claude/Anthropic family 只扩展为 `openai-responses + anthropic-messages`；不授予 Kimi Chat Completions。
- explicit `api_protocols` 与 legacy `compatible_engines` 仍优先于 family fallback；unknown explicit protocol 继续 fail closed。
- Renderer 没有新增 per-surface model list；所有 consumer 继续复用 single Product target catalog。
- managed configuration revision 从 `1` 升为 `2`。fresh/missing config 直接写 revision 2；revision 1 在首次 exact Codex send 的 pre-side-effect prepare 中被替换；unrelated user providers 保留，重复 prepare idempotent。
- 登录 startup 仍只做 catalog/credential reconciliation，不执行三引擎 blocking install/configuration。

## L3 automated verification

| Gate | Result |
| --- | --- |
| Focused Product Vitest | PASS，7 files / 45 tests：protocol projection、single catalog、picker、execution target、Kanban、lazy provisioning、non-blocking Account Gate |
| Rust Product model tests | PASS，19 tests：Claude fallback、explicit authority、legacy authority、unknown fail-closed |
| Product boundary/refresh Vitest | PASS，2 files / 10 tests：Native wire normalization、last-known-good refresh/stale behavior |
| Rust configuration tests | PASS，14 tests：fresh revision 2、missing/revision-1 rejection and replacement、sibling preservation、idempotence |
| `npm run typecheck` | PASS |
| Target ESLint | PASS，0 diagnostics |
| Changed-file `rustfmt --check` | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml --lib` | PASS，仅仓库既有 warnings |
| `npm run check:runtime-contracts` | PASS |
| `npm run check:model-provider-catalog` | PASS |
| `npm run check:engine-capability-matrix` | PASS |
| `npm run check:docs` | PASS，155 prose / 35 JSON artifacts |
| `npm run doctor:strict` | PASS |
| `npm run check:large-files` | PASS in report mode；103 个既有 inventory items，本 change 未新增 large source file |
| OpenSpec strict validation | PASS |
| `git diff --check` | PASS |
| macOS debug `.app` build | PASS，`src-tauri/target/debug/bundle/macos/doge.app` |

Repository-wide `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 仍报告本 change 未修改的 `src-tauri/src/codex/doctor.rs` 与 `src-tauri/src/engine/kimi_launch.rs` 既有格式差异；本 change 的四个 Rust files 已由 direct `rustfmt --check` 独立证明 clean。

## Manual and L4 scope

- 2026-08-30 用户已在当前分支 canonical Hot Doge 完成目视验收并确认通过：Codex 可见/可选 Claude-family model，交互与现有 Product target picker 一致。
- 未运行全量 `npm run test` / `cargo test`、Windows/Linux/macOS release build、签名与安装包 smoke；这些是 L4 Release/CI scope。
