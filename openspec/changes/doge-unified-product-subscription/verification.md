# Verification: Doge 全产品统一订阅

## Verification level

`L4 Release / CI`。触发原因：用户明确要求全量验收；改动同时覆盖 React、Tauri IPC、auth/vault、managed provider、CLI installer、engine/model routing、支付履约与本地持久化。

## Automated evidence（2026-08-23）

| Gate | Result |
|---|---|
| `npm run test` | PASS，1119 test files；在 `fix(dev)` / Trellis record 提交后再次全量复跑 |
| `npm run test:integration` | PASS，1122 test files，包含 3 个 heavy race suites |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS：lib 2113 passed / 2 ignored；daemon 1145 passed；全部 Rust integration/doc tests passed |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS，0 errors；14 条既有 `react-hooks/exhaustive-deps` warnings |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml --bins` | PASS；保留仓库既有 Rust warnings |
| `npm run build` | PASS；保留既有 chunk size / mixed static-dynamic import / CSS minifier warnings |
| `tauri build --debug --bundles app` | PASS；生成当前源码 debug bundle `src-tauri/target/debug/bundle/macos/doge.app` |
| `npm run doctor:strict` | PASS（runtime contracts、branding、doctor） |
| `npm run check:engine-capability-matrix` | PASS |
| `npm run check:engine-adapter-registry` | PASS |
| `npm run check:model-provider-catalog` | PASS |
| `npm run check:capability-aware-policy-router` | PASS，advisory inventory 477 findings |
| `npm run check:large-files` | PASS report mode；仓库 baseline/new-file ratchet 仍列出现有大文件 |
| `openspec validate doge-unified-product-subscription --strict --no-interactive` | PASS |
| `git diff --check` | PASS |

## Isolated baseline governance failures

- `npm run check:engine-controller-facade`：`src/features/engine/hooks/useEngineController.ts` 为 610 行，超过 600 行阈值；本 change 未修改该文件。
- `openspec validate --all --strict --no-interactive`：543 passed / 4 unrelated active changes failed：`add-sub2api-relay-quota`、`fix-ui-scale-native-zoom-freeze-all-platforms`、`fix-windows-cold-start-freeze-residual`、`retire-canvas-subagent-squad-grid`。当前 change 单独 strict validate 通过。

## Real runtime evidence

- 标准入口 `npm run tauri:dev:hot` 现显式执行 `tauri dev --config src-tauri/tauri.dev.conf.json`；Vite 与 effective `TAURI_CONFIG` 均为 `http://localhost:1420`。
- 本轮发现此前 `tauri.dev.conf.json` 的 `1430` 覆盖与 bootstrap `1420` 不一致，导致 UI 自动化可能连到旧 bundle / stale `dist`；`0b0733feb` 已修复并由 branding + dev startup contract 锁定。
- macOS debug local vault 未触发 Keychain / SecurityAgent 授权；当前源码 debug `.app` bundle 已完整编译成功。
- debug vault 目录/文件权限分别为 `0700` / `0600`；`config.json` 不含 managed secret；Codex/Kimi provider TOML 为 owner-only。
- `Kimi CLI 0.38.0 × kimi-for-coding` 使用 managed `KIMI_CODE_HOME` 返回 typed assistant terminal `DOGE_E2E_OK`。
- `Codex 0.147 × gpt-5.5` 使用 managed `CODEX_HOME` 请求后由 production Composite GPT pool 返回 terminal 503；Doge 未做 silent fallback。
- `Claude Code 2.1.233 × claude-sonnet-4-8` 使用 Doge private settings / managed token 后返回 `claude-code:unrecognized_model`；Doge 未回退 first-party OAuth。

### token2api production admin audit（尚无持久化写入）

- `Doge APP` 当前是 `Composite` subscription group，共 7 个账号，页面显示 5 个可用。
- Composite 路由弹窗的 authoritative saved state 为“暂无 Composite 路由”。
- 账号列表可见 `Kimi #37`、`豆包 OpenAI #34`、`豆包 Anthropic #35` 已绑定 `Doge APP`。
- `Claude #11` 当前只绑定“测试分组”，没有绑定 `Doge APP`。
- 在 edit dialog 点击“同步上游支持的模型”做只读 capability probe：上游共声明 9 个，临时表单新增 `claude-fable-5`、`claude-opus-5`、`claude-sonnet-5`；未点击“更新”，没有保存 group/model 变更。
- 未点击创建、更新、删除或调度操作；Composite 路由和账号绑定仍保持原生产状态。

## Remaining external/manual blockers

- token2api production `Doge APP` 尚未把 Claude account 接入，且当前没有任何 saved Composite route；Claude binding 与 endpoint-specific Composite routes 已到 action-time confirmation 边界，等待用户明确确认后才会保存。配置完成后需重跑 Codex/Claude exact CLI terminal matrix。
- 当前 macOS 会话处于锁屏状态，Computer Use 无法完成最终 Account Center dark/light/narrow screenshot 与 picker 点击验收；自动化 visual contracts 和此前 hot-dev smoke 已通过，但该项不冒充人工目视完成。
- 未覆盖 Windows Credential Manager / installer、Linux Secret Service、macOS Release Keychain 实包、真实第三方支付回调与跨设备并发；这些继续由 Release/平台 smoke 承担。
