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

### Account bootstrap 错误详情增量验证（2026-08-23）

- Verification level：`L2 Feature`。仅修改 Account feature 内 component/copy/style 与测试；未修改 IPC、auth/vault、持久化或 startup runtime。
- `npx vitest run src/features/account/components/AccountExperience.test.tsx src/features/account/components/accountVisualContract.test.ts --reporter=dot`：PASS，2 files / 33 tests。
- `npm run typecheck`：PASS。
- targeted ESLint（`AccountExperience`、`AccountHelpTooltip`、copy 与相关 tests）：PASS，0 errors / 0 warnings。
- `git diff --check`：PASS。
- `npm run check:large-files`：report mode 完成；仍报告仓库既有 baseline/new-file ratchet，其中 `account-experience.css` 已是既有大文件，本次仅增加错误详情 scoped rules。
- 行为证据：pointer hover 与 keyboard focus 均打开真实 Tooltip portal；Enter 展开带 `aria-expanded/aria-controls` 的多行 safe diagnostics；再次点击收起并清除 Tooltip portal。显示值只来自 validated `GatewayFailureV1.code/stage/recovery.action`，不渲染 raw backend message、stack 或 secret。
- 视觉 contract：Account Gate 为 `z-index: 10000`，portalled Account help Tooltip 显式提升到 `10020`，修复截图中已渲染 Tooltip 被全屏 Gate 遮挡的问题。

### Product UI hot feedback 增量验证（2026-08-23）

- Verification level：`L3 Cross-layer`。影响 product-ready Composer target presentation、managed provider config projection、Account progressive details 与 shared brand icon owner；stable provider id、IPC payload、vault secret contract 与 Native immutable binding 未改变。
- affected Vitest：PASS，Composer/ModelSelect/Product panel/Account details/visual contract/product target/vendor grouping/icon resolver/raster bounds 共 9 files / 127 tests。
- `npm run typecheck`：PASS；targeted ESLint：PASS；`cargo fmt --all -- --check`：PASS。
- `cargo test --manifest-path src-tauri/Cargo.toml configuration_tests --lib`：PASS，10 tests；证明 Codex TOML 与 Codex/Claude/Kimi registry 均写 `name="Doge"`，且 secret-safe contract 不变。
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`：PASS，只有仓库既有 warnings。
- `npm run check:runtime-contracts`：PASS。
- `npm run check:large-files`：report mode 完成，仍只报告仓库既有 baseline/new-file ratchet；本轮没有新增超阈值 source file。
- 本机 authenticated hot prepare 实证：`~/.doge/config.json` 的 Codex/Claude/Kimi managed entries 与 Codex provider-home TOML 均已从旧显示名迁移为 `Doge`；只读取 name 字段，未输出 secret。
- 豆包 asset：`src/assets/model-icons/doubao.png` 与用户提供 PNG 的 SHA-256 相同；`豆包` / `doubao-entry` / `ark-code-latest` 共用该 asset。`ProviderBrandIconImg` 固定 `16×16` intrinsic size 并限制 `max-width/max-height:100%`、`object-fit:contain`，避免 1024px raster 在 stylesheet 未加载时按原尺寸铺满。

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
- 保存 endpoint-specific Composite routes 后，`Kimi CLI 0.38.0 × kimi-for-coding` 再次返回精确 terminal `DOGE_KIMI_ROUTE_OK`，证明 Kimi route 未破坏既有链路。
- `Claude Code × claude-sonnet-4-6` 已从原 `unrecognized_model` 前进到 authoritative terminal 503：`no available accounts supporting model ... (channel pricing restriction)`，证明 Messages route 命中但 pricing channel 拒绝。
- `Claude Code × 豆包` 同样到达 token2api 并以 `channel pricing restriction` 503 终止；`Codex × 豆包` 和 direct Chat Completions × 豆包均为 503，无 silent fallback。
- 未先执行 Doge prepare 时，Kimi CLI 对未定义 `豆包` alias 复现 upstream lifecycle crash；该 cell 必须在 App 选择模型、重写 Kimi alias table 后再验，不以 raw CLI 直传冒充完成。

### token2api production admin audit 与已授权路由写入

- `Doge APP` 当前是 `Composite` subscription group，共 7 个账号，Claude 绑定后页面显示 6 个可用。
- 账号列表可见 `Kimi #37`、`豆包 OpenAI #34`、`豆包 Anthropic #35` 已绑定 `Doge APP`。
- 用户已手动将 `Claude #11` 绑定到 `Doge APP`；其账号模型白名单仍是原 6 个，本轮没有擅自保存 capability probe 的 3 个新增模型。
- 经用户明确授权，已保存并关闭/重开复核 7 条 route：`claude-` prefix / Messages → Anthropic；`gpt-` prefix / Responses → OpenAI；`kimi` 与 `k3` prefix / Chat Completions → Kimi；`豆包` exact 分别按 Messages → Anthropic、Responses / Chat Completions → OpenAI。全部 priority 100、上游模型透传。
- 配置后 `/v1/models` 已实时返回 Claude 5、GPT、Kimi 与 `豆包` rows；production 仍不提供独立 `model` / `compatible_engines` 字段，Doge 继续使用 fail-closed conversation filter + family fallback。
- Channel pricing read-only audit 证明 `Doge APP` 唯一属于“Kimi 官方定价”；Claude channel 中 `Doge APP` checkbox 被禁用并显示“已属于『Kimi 官方定价』”。当前 UI 的 single-channel ownership 正是 GPT / Claude / 豆包 503 pricing restriction 根因。

## Remaining external/manual blockers

- token2api 需要一个覆盖 OpenAI + Anthropic + Kimi + `ark-code-latest` 的统一 pricing channel，或等价的 multi-channel group 能力；仅保存 Composite routes 无法绕过当前 single-channel pricing restriction。该变更超出用户本轮“只保存路由”的授权，尚未执行。
- `Claude #11` 账号白名单仍是原 6 个；public catalog 已出现 Claude 5 rows，但真实账号 eligibility / pricing 尚未同步收口。
- 当前 macOS 会话处于锁屏状态，Computer Use 无法完成最终 Account Center dark/light/narrow screenshot 与 picker 点击验收；自动化 visual contracts 和此前 hot-dev smoke 已通过，但该项不冒充人工目视完成。
- 未覆盖 Windows Credential Manager / installer、Linux Secret Service、macOS Release Keychain 实包、真实第三方支付回调与跨设备并发；这些继续由 Release/平台 smoke 承担。
