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
- 二次实机反馈证明 HTML `width/height` attribute 会被现有 `.selector-model-brand-icon img { width:100%; height:100% }` author CSS 覆盖，且 Product trigger 的内层 wrapper 原为 auto-size / overflow-visible。修复后 `<img>` 使用 inline `width:16px;height:16px`，wrapper 同时固定 `16×16 + overflow:hidden`；focused Vitest 3 files / 66 tests、typecheck 与 targeted ESLint 均 PASS。
- `Kimi + 豆包` 三轮实机证据：① UI 为豆包，但 config 无 alias、Kimi `llm config model=gpt-5.5` 后连续 503；② runtime 贯穿后 config/request=`ark-code-latest`，token2api 返回 400 `Model is not supported by composite groups`；③ 清空 config + Composer state 后自动 prepare，生成 bare + `doge/` 豆包 alias，Kimi `llm config model=豆包` 且连续收到 HTTP 503。由此证明 Doge/Kimi 出站链已正确，当前请求在 token2api Composite 的 account dispatch/usage logging 前被 pricing/channel policy 拒绝；admin usage/inbound surface 无记录不代表未发请求。focused Vitest 4 files / 59 tests、typecheck 与 targeted ESLint PASS。
- 经用户明确授权，production UI 将原 `Kimi 官方定价` 更新为 `Doge 统一定价`：`Doge APP` 仍为唯一关联 group，Kimi 4 条官方 price 不变，OpenAI 新增单条 model rule，aliases=`ark-code-latest, 豆包`，8 个 token price 字段均为空（Coding Plan subscription，不伪造 per-token price）。保存后列表显示 1 group / 5 prices；关闭重开确认 aliases/空 price 持久化。随后使用同一 managed key 直连 `POST /v1/chat/completions model=豆包` 返回 HTTP 200、model=`豆包`、精确正文 `DOGE_DOUBAO_PRICING_OK`，证明 pricing gate 与 account dispatch 已通过。
- 用户复现 `Codex + gpt-5.6-luna` 后，rollout 证明 model selection 正确，失败来自 `/responses` terminal 503；当时 `Doge 统一定价` 只有 Kimi/豆包 5 条规则。经授权复制 `OpenAI 官方定价` 的 `gpt-5.6-luna` default `0.2/1.2/0.25/0.02 $/MTok` 与 `(0,272000]`、`(272000,+∞]` 分层价，保存/重开确认列表为 6 条。分别使用旧 dev account 与 canonical doge account 的 managed Codex key 直连 `/responses` 均 HTTP 200，并返回 `DOGE_CODEX_PRICING_OK` / `DOGE_CANONICAL_CODEX_OK`。
- 2026-08-24 `gpt-5.6-sol/terra` 复现审计：managed Codex rollout 的 `turn_context/thread_settings_applied` 分别冻结 exact `gpt-5.6-sol` 与 `gpt-5.6-terra`，provider=`DogeTokenMatrix`、endpoint=`https://token-matrix.com/responses`，两者均 terminal 503；同配置 Luna terminal success。使用两个本地 managed scopes 做同 payload `/responses` matrix，修复前 Luna=200、Sol/Terra=503，排除 Doge config/model rewrite。
- production `Doge 统一定价` 的 OpenAI platform 开启“限制模型”，当时 GPT rule 仅含 `gpt-5.6-luna`。经既有管理员 UI 授权将 `gpt-5.6-sol + gpt-5.6-terra` 加入同一 Luna rule，保留现有 default `0.2/1.2/0.25/0.02 $/MTok` 与长上下文分层，不改 Composite route/account pool。保存并关闭重开确认三 aliases 持久化。修复后两个 managed scopes 对 Luna/Sol/Terra 全部 HTTP 200；bundled Codex CLI `0.147.0` + isolated `CODEX_HOME` 对 Sol/Terra 分别 exact typed success `DOGE_SOL_OK` / `DOGE_TERRA_OK`。
- Codex local history parser 现在将 failed `event_msg.task_complete.error` 恢复为 stable assistant diagnostic，保留 terminal timestamp/duration；成功 `task_complete` 不合成错误。focused Vitest `historyLoaders.test.ts` 51 tests PASS，避免 realtime 503 在 history hydrate 后消失。
- 单一开发身份验证：Node startup/signing tests 8 PASS；brand/history Vitest 54 PASS；`npm run check:branding`、typecheck、targeted ESLint、runtime contracts、两个 affected OpenSpec strict validate 与 `git diff --check` 均 PASS。canonical debug vault 仍为 file `0600` / directory `0700`，包含 refresh + 三 engine purposes，启动未访问 Keychain。
- Claude continuation hang 根因：operation `838f942f-cf79-4eee-b6e7-14723b0bc638` 已 durable 记录 `recovery-required / target-provider-rejected`，target transcript 为 `API Error 503 ... 豆包 (channel pricing restriction)`；但 Claude live stdout 使用 `is_api_error_message`，旧 adapter 把 synthetic assistant 当正文并等待 EOF，导致 Dialog 长停 `delivering-context`。修复后 camel/snake API-error assistant 与 `result.is_error` 都归一为 terminal `TurnError`，立即 cleanup exact process group。
- Claude focused Rust：`api_error` filter 4 PASS；`engine::claude::tests_stream` 42 PASS；`native_continuation::commands::tests` 11 PASS。覆盖 snake live shape、camel compatibility、error result、stdout 持有 30s 仍 bounded settlement、一个 error/零 completed、recovery rejection precedence。
- 经用户授权，production `Doge 统一定价` Anthropic platform 增加 `claude-sonnet-4-6` 官方 `3/15/3.75/0.3 $/MTok` 与 `ark-code-latest + 豆包` 空价格 Coding Plan allowlist；保存/关闭/重开后 channel 为 1 group / 8 prices。canonical managed key 直连 `/v1/messages` 对 Sonnet/豆包均 HTTP 200。
- 真实 Claude Code `2.1.233` managed private settings：`claude-sonnet-4-6` 返回 `DOGE_CLAUDE_SONNET_OK`，`豆包` 返回 `DOGE_CLAUDE_DOUBAO_OK`，均 `result.success / is_error=false`。随后将截图 operation 的 frozen Codex Context Package 原样以 stream-json 注入 `Claude + 豆包` session `54bc97c0-1620-4401-bf87-3ab1fb54a7e3`，bootstrap 返回 `DOGE_PRODUCT_CONTINUATION_CONTEXT_OK`；同一 session `--resume` 正确读取来源短语并返回 `DOGE_PRODUCT_CONTINUATION_RESUME_OK`，证明 Context delivery 与 native continuation 语义有效。
- L3 gates：`cargo fmt --all -- --check`、`cargo check --lib`、`npm run typecheck`、`npm run doctor:strict`、runtime contracts、engine capability/adapter/model-catalog gates、current OpenSpec strict validation 与 `git diff --check` PASS；仅保留仓库既有 Rust warnings。
- Account usage range/model table L3：本地上游源码确认 `/api/v1/usage/stats` 原生消费 `start_date/end_date`，`/api/v1/usage/dashboard/snapshot-v2` 原生消费同 range 与 `day|hour` granularity；Doge 未修改 token2api。Renderer → service → Tauri → Rust authority 已统一为 `startDate/endDate/granularity`，Native 在任何 network read 前拒绝 malformed、future、reversed、超过 366 天与超过 32 天的 hourly query，并继续重新验证 active Composite subscription/group。
- Account progressive UI：移除页面副标题、quota/engine filler、engine unavailable roster 与 request-only model ranking；现有 upstream model `requests/total_tokens/actual_cost/standard_cost` 合并为 semantic table。preset/custom range 切换使用 query-key generation fence，focused regression 证明慢的旧 range 响应不能覆盖新选择。
- Account overlay/icon visual：range Popover 强制 opaque `surface-popover` + `opacity:1`，避免下层 stat/table 穿透；provider/LLM icon 统一走 `ProviderBrandIconImg` 的 `original | mono-adaptive | dark-tile` strategy。OpenAI/Anthropic/Moonshot/OpenCode/Xiaomi mono SVG 在 dark/dim/system-dark 反白，豆包等彩色 asset 保持原色，Kimi 保持 dark tile；Account 不再裸渲染 icon `<img>`。
- Focused frontend：13 files / 120 tests PASS；targeted ESLint、`npm run typecheck`、runtime contracts、current OpenSpec strict validation、`git diff --check` PASS。Rust `product_usage` 2 tests与 authority group/granularity query 1 test PASS；`cargo check --lib`、`cargo fmt --all -- --check` PASS（仅仓库既有 warnings）。`npm run check:large-files` report mode 完成，仍报告既有 baseline/new-file ratchet，未因本轮新增 source file 形成新的 runtime blocker。
- Raw `tauri dev` 仍无法被 Computer Use/LaunchServices 附着；未启动旧 packaged `.app` 冒充目视验收。用户已在 canonical hot App 截图确认 range/table 初版，并暴露 Popover transparency 与 OpenAI mono contrast；修复后 static visual contracts 与 HMR source 已通过，最终 exact App 目视由当前 hot window 继续确认。
- Token trend/KMB hot increment：复用 snapshot `trend[]` 投影 Input/Output/Cache Creation/Cache Read，Cache Hit Rate 严格复制 token2api `cacheRead / (input + cacheRead + cacheCreation)` 公式并使用右侧百分比轴；五个 legend button 均可本地 hide/restore，紫色 hit-rate 为 dashed series。model table 限高 320px、sticky header + vertical scroll，宽屏两 panel stretch 对齐。`formatTokenCount` 修复整数尾零误删（`700_000 -> 700K`，不再错误成为 `7K`），core Account/Context/Status/Composer/Message/engine-output Token surfaces 统一 uppercase `K/M/B`。
- Minimal requested verification：Account/formatter focused 6 files / 27 tests PASS；core formatter consumers 4 files / 87 tests PASS；Cache Hit Rate/legend follow-up 4 files / 21 tests PASS；target ESLint 与 `npm run typecheck` PASS。Rust `product_usage` 3 tests PASS，包含 safe trend bucket projection；只保留仓库既有 warnings。canonical `target/debug/doge` 与 Vite `127.0.0.1:1420` 正在运行供用户 hot 验收。

## Isolated baseline governance failures

- `npm run check:engine-controller-facade`：`src/features/engine/hooks/useEngineController.ts` 为 610 行，超过 600 行阈值；本 change 未修改该文件。
- `openspec validate --all --strict --no-interactive`：543 passed / 4 unrelated active changes failed：`add-sub2api-relay-quota`、`fix-ui-scale-native-zoom-freeze-all-platforms`、`fix-windows-cold-start-freeze-residual`、`retire-canvas-subagent-squad-grid`。当前 change 单独 strict validate 通过。

## Real runtime evidence

- 标准入口 `npm run tauri:dev:hot` 现通过 `scripts/tauri-dev-hot.mjs` 先拒绝 packaged Doge single-instance conflict，再执行 canonical `tauri dev`；继续只继承 `src-tauri/tauri.conf.json`：`productName=doge`、`identifier=io.github.jasonmao-msj.doge`、Vite `1420`。独立 `tauri.dev.conf.json`、`doge-dev` manifest fields 与 bundle identifier 已删除。
- 2026-08-24 用户截图中的“选择引擎”由 `/Applications/doge.app/Contents/MacOS/doge` 旧内置 bundle 提供，非当前源码路由；进程审计与 Computer Use WebView evidence 为 `tauri://localhost`。关闭该 PID 后，exact `npm run tauri:dev:hot` 启动 `target/debug/doge`，Vite `127.0.0.1:1420` 监听，served `/src/router.tsx` 只 import/render `ProductAccountAppGate`。新增 `tauri-dev-hot.test.mjs` 锁定 `.app` conflict 与 raw debug exclusion。
- 用户截图与进程审计证明旧 `doge-dev` 是独立 app-data/UI state；Computer Use 还会从 `target/debug/bundle/macos/doge-dev.app` 重新唤起陈旧 bundle。该生成物已移动到废纸篓，当前 hot process 仅为 `target/debug/doge`，且 `lsof` 证明读取 canonical `io.github.jasonmao-msj.doge` app-data。
- macOS debug local vault 未触发 Keychain / SecurityAgent 授权；当前源码 debug `.app` bundle 已完整编译成功。
- debug vault 目录/文件权限分别为 `0700` / `0600`；`config.json` 不含 managed secret；Codex/Kimi provider TOML 为 owner-only。
- `Kimi CLI 0.38.0 × kimi-for-coding` 使用 managed `KIMI_CODE_HOME` 返回 typed assistant terminal `DOGE_E2E_OK`。
- `Codex 0.147 × gpt-5.5` 使用 managed `CODEX_HOME` 请求后由 production Composite GPT pool 返回 terminal 503；Doge 未做 silent fallback。
- `Claude Code 2.1.233 × claude-sonnet-4-8` 使用 Doge private settings / managed token 后返回 `claude-code:unrecognized_model`；Doge 未回退 first-party OAuth。
- 保存 endpoint-specific Composite routes 后，`Kimi CLI 0.38.0 × kimi-for-coding` 再次返回精确 terminal `DOGE_KIMI_ROUTE_OK`，证明 Kimi route 未破坏既有链路。
- 历史阶段中 `Claude Code × claude-sonnet-4-6` 与 `Claude Code × 豆包` 曾以 `channel pricing restriction` 503 终止；§16.21 合并 Anthropic pricing 后，两者已由 exact CLI typed success 取代该 blocker。
- 用户从 product-ready Home 首发 `Claude + claude-opus-4-8` 时出现 OpenRouter 402。代码审计证明 Composer 已冻结 `doge-token-matrix` target，但 `useThreadMessaging` 的本地 options contract 丢弃 `createSessionTarget`，且仅 Codex 首发透传 Provider；Claude pending thread 因而以 `providerProfileId=null` 创建并继承 `~/.claude/settings.json`。修复后 focused Vitest 直接断言 Claude thread create 与 `engineSendMessage` 均携带 `doge-token-matrix + claude-opus-4-8`。
- 直接 managed Messages 在补价前返回 `channel pricing restriction` 503；从 `Claude 官方定价` 精确复制 `claude-opus-5 + claude-opus-4-8` 的 `5/25/6.25/0.5 $/MTok` 到 `Doge 统一定价` 后，渠道由 8 条变为 9 条。相同 managed key 的 `/v1/messages` 返回 HTTP 200 + exact `DOGE_OPUS_HTTP_OK`；使用与 APP 相同 private `--settings` 隔离（清空 inherited routing env）的 Claude Code 2.1.233 返回 typed success `DOGE_OPUS_48_MANAGED_OK`。临时 settings 以 `0700/0600` 创建并已删除，未输出 secret。
- 当前 managed `/v1/models` 初始返回 13 个 `claude-*` ids，全部缺少 `runtime_model/compatible_engines`。13/13 Messages probe：Opus 4.8、Opus 5、Sonnet 4.6 HTTP 200；Fable 5、Opus 4.5 dated/short、Opus 4.6/4.7、Sonnet 5、Sonnet 4.5 dated/short 均 pricing restriction 503；Haiku 4.8、Sonnet 4.8 无账号支持 404。对 3 个 HTTP candidates 使用 APP 等价 private-settings Claude Code payload：仅 Opus 4.8 exact typed success；Opus 5 返回 `403 daily usage limit exceeded`；Sonnet 4.6 在 60s bounded window 无 terminal并完成 process-group cleanup。
- 经用户确认 catalog authority 应留在上游 UI，未在 Doge 增加 exact-id filter。token2api 管理后台把 Claude #11/#41/#42 的账号模型白名单都保存并关闭重开为仅 `claude-opus-4-8`；`Doge APP` 分组的自定义 `/v1/models` 展示列表取消其余 16 个 Claude selections，保留非 Claude 选择不变。测试账号额度重置后 managed `/v1/models` HTTP 200，total=11、Claude count=1、唯一 Claude row=`claude-opus-4-8`。
- Home 与 Sidebar 的同模型对照复现 split routing：Sidebar 创建后再输入能读取已发布的 managed thread binding；Home/Kanban 在同一 callback 内先创建 pending thread 再立即发送，reducer 尚未 rerender，而 wrapper 又剥离 `createSessionTarget`，发送侧因此读取 null 并落到 ambient OpenRouter。修复后 Kanban focused test 断言完整 target 继续下传，ThreadMessaging regression 在 provider store 为空时仍断言 `engineSendMessage.providerProfileId=doge-token-matrix`；112 tests PASS。
- 未先执行 Doge prepare 时，Kimi CLI 对未定义 `豆包` alias 复现 upstream lifecycle crash；该 cell 必须在 App 选择模型、重写 Kimi alias table 后再验，不以 raw CLI 直传冒充完成。

### token2api production admin audit 与已授权路由写入

- `Doge APP` 当前是 `Composite` subscription group，共 7 个账号，Claude 绑定后页面显示 6 个可用。
- 账号列表可见 `Kimi #37`、`豆包 OpenAI #34`、`豆包 Anthropic #35` 已绑定 `Doge APP`。
- `Claude #11/#41/#42` 均绑定 `Doge APP`，且经实测后账号模型白名单统一收敛为仅 `claude-opus-4-8`；分组自定义 `/v1/models` 是所有 Doge 用户的动态展示 authority。
- 经用户明确授权，已保存并关闭/重开复核 7 条 route：`claude-` prefix / Messages → Anthropic；`gpt-` prefix / Responses → OpenAI；`kimi` 与 `k3` prefix / Chat Completions → Kimi；`豆包` exact 分别按 Messages → Anthropic、Responses / Chat Completions → OpenAI。全部 priority 100、上游模型透传。
- 配置后 `/v1/models` 已实时返回 Claude 5、GPT、Kimi 与 `豆包` rows；production 仍不提供独立 `model` / `compatible_engines` 字段，Doge 继续使用 fail-closed conversation filter + family fallback。
- Channel pricing 已收口为 single-owner `Doge 统一定价`：Kimi 4 条、OpenAI 豆包、OpenAI `gpt-5.6-luna + gpt-5.6-sol + gpt-5.6-terra`、Anthropic `claude-sonnet-4-6`、Anthropic `claude-opus-5 + claude-opus-4-8`、Anthropic 豆包共 9 条 price rules；`Doge APP` 仍为唯一关联 group。

## Remaining external/manual blockers

- `Doge 统一定价` 当前已覆盖 Kimi + 豆包 Coding Plan + `gpt-5.6-luna/sol/terra` + `claude-sonnet-4-6` + `claude-opus-4-8`；其余 GPT/OpenAI 与 Claude/Anthropic release models 仍需把相应 official/current product price rules 合并进同一 single-owner channel，不代表全部动态 catalog rows 都已通过 exact CLI 验收。
- Claude 当前对外仅发布已通过 exact CLI 的 `claude-opus-4-8`；后续模型通过验证后只需修改 token2api 账号白名单与 `Doge APP` 自定义 `/v1/models` 列表，无需 Doge 发版。
- Computer Use 无法附着 raw `tauri dev` process（LaunchServices 将其报告为 not running）；为避免再次启动 stale packaged App，本轮没有用 bundle-id automation 冒充 product UI 点击验收。用户已对上一轮 canonical doge UI 验收；本轮保留 exact runtime/package/resume evidence，并由用户在当前 hot App 做最终点击 smoke。
- 未覆盖 Windows Credential Manager / installer、Linux Secret Service、macOS Release Keychain 实包、真实第三方支付回调与跨设备并发；这些继续由 Release/平台 smoke 承担。
# 2026-08-24 Native Provider Continuation atomic target regression

- 真实失败 request `b10634ac-9994-450d-93d4-1789dba9e975` 的 Codex rollout 显示 UI 最终为 `gpt-5.6-sol`，但 durable continuation materialization 实际冻结 `destination={engine:codex, model:豆包}`，新 thread 的 `thread_settings_applied/turn_context` 随后回落 `gpt-5.5` 并在 `/responses` 返回 503。
- 同分钟独立新建 `Codex + gpt-5.6-sol` rollout 的 `turn_context.model=gpt-5.6-sol`，7s terminal success，排除 managed credential 与 Sol pricing route。
- 根因是 `ProductEngineModelSelect` 在 engine radio click 时立即发布完整 Target，跨 engine 且来源 model 仍 compatible 时会在用户点击目标 model 前启动 Provider Continuation。
- 修复后 engine click 只更新 panel-local draft；model click 才一次发布 `engine + modelCatalogEntryId + runtime model + doge-token-matrix`，panel 保持打开，只有 Escape/scrim/显式 close 关闭。
- Focused regression：`ProductEngineModelSelect.test.tsx`、`Composer.file-reference-token.test.tsx`、`useSidebarMenus.test.tsx` 共 89/89 通过；`npm run typecheck -- --pretty false` 与 targeted ESLint 通过。
- Commit 前最终 L3：affected frontend 27 files / 487 tests 全绿；changed-file ESLint 与 TypeScript typecheck 全绿；Rust `account::` 107 tests（106 passed / 1 live-authority ignored）与 `cargo check --lib` 通过；dev scripts 10/10、runtime contracts、engine capability/adapter/model catalog、docs、branding、large-file report 与本 change OpenSpec strict 全绿。
- `openspec validate --all --strict` 仍有 4 个 repository baseline active change failure（含 `fix-ui-scale-native-zoom-freeze-all-platforms`、`fix-windows-cold-start-freeze-residual`、`retire-canvas-subagent-squad-grid`），均不在本次 diff；`doge-unified-product-subscription` individual strict validation 通过。

## 2026-08-24 PR review remediation

- Verification level：`L3 Cross-layer / High-risk`。最高触发项为 payment checkout recovery、account/device scoped managed credential identity、product-ready session routing 与 React polling owner；影响 Native Authority/Runtime、renderer Gate/Sidebar/Composer、OpenSpec/Trellis executable contract 与 multi-CLI foundation calibration。
- Backend：product remote key canonical name 改为 authenticated account scope 下的 `group_id + sha256(device_id)` prefix，same group/device stable、cross-device/group distinct且不暴露 raw device/plan copy；`refunded/partially_refunded` closed projection 为 terminal `failed`。
- Frontend：checkout poll 由 stable `checkoutId/status/expiresAt` effect 持有 attempt，transient failure 按 `max(backoff,retryAfterMs)` 自动续读，expiry 后零 additional read；product-ready Sidebar 三 engine direct action 绕过 Local Mode blacklist；model commit 后 picker 保持打开。
- Affected frontend：43 files / 672 tests PASS；其中新增 regression 覆盖 poll snapshot 不重置、cooldown retry、absolute expiry、disabled product Kimi 与 panel stays-open。
- Rust：`cargo test --manifest-path src-tauri/Cargo.toml 'account::' --lib` PASS（105 passed / 2 ignored）；`cargo check --lib` 与 `cargo fmt --all -- --check` PASS，只保留 repository baseline warnings。
- Static/contracts：changed-file ESLint、`npm run typecheck`、`npm run doctor:strict`、engine capability/adapter/model catalog、docs governance、branding、large-file report、current OpenSpec strict validation 与 `git diff --check` PASS。
- 未运行 L4：全量 `npm run test` / Rust workspace tests、Release build、Windows/Linux/macOS installer smoke 与真实 payment callback；由 Release/CI 承担。

## 2026-08-25 Product engine visibility and hidden management surface

- Verification level：`L3 Cross-layer / High-risk`。影响 Rust settings persistence/read authority、TypeScript boundary normalization、Settings/Composer presentation、authenticated product provisioning contract 与 OpenSpec/Trellis；未改变 engine registry、Shared supported set、Provider binding identity、vault schema 或 IPC payload。
- Visibility authority：Rust `get/update/restore_app_settings_core` 与 TypeScript `normalizeDisabledCliEngines` 都移除 `claude/codex/kimi`，默认 blacklist 只保留 `grok/opencode`；旧安装中的 Kimi disabled 值不能再进入 Composer/Sidebar/Git consumers。
- UI surface：Settings sidebar 不渲染 Engine Management；`providers/vendors/permissions` deep link 回退 Basic Settings 且不 mount `VendorSettingsPanel`；legacy `ModelSelect` footer action隐藏。底层 vendor/config diagnostics 保留为内部实现。
- Managed configuration：未新增第二套写入链。`ProductAccountAppGate` 仍先完成 Codex/Claude/Kimi provisioning，再调用唯一 `account_product_v1_prepare`；Native 继续逐一 apply/verify `doge-token-matrix` registry。
- Frontend focused：`useAppSettings`、`SettingsView`、`ModelSelect`、`productOnboardingClient` 共 4 files / 156 tests PASS；`productEngineProvisioning` + `ProductAccountAppGate.lifecycle` 共 2 files / 11 tests PASS。
- Rust focused：settings read/update/restore regression PASS；`app_settings_defaults_from_empty_json` PASS；`configuration_tests` 12/12 PASS，覆盖三引擎 managed projection、stale revision、unrelated provider preservation 与 secret absence。
- Static/compile：targeted ESLint PASS；`npm run typecheck` PASS；`cargo fmt --all -- --check` PASS；`cargo check --lib` PASS（仅 repository baseline warnings）；`npm run check:runtime-contracts`、`npm run doctor:strict`、`npm run check:docs`、`git diff --check` 与 current OpenSpec strict validation PASS。
- `npm run check:large-files`：report mode EXIT 0；报告仓库既有 baseline/new-file ratchet（含既有 large Settings/ModelSelect files），本轮未新增 large source file或扩大完整文件格式化 diff。
- Engine Onboarding §0：本轮只命中 E7 visibility 与 G1/G3 Settings surface；A–D identity/runtime/capability/render、F Shared、H i18n 均未改变。⚠ consumer search 已覆盖 Settings navigation、model footer、legacy deep link 与 `disabledCliEngines` seed path。
- 未运行 L4：全量 Vitest/Rust workspace tests、Release build、Windows/macOS 安装包与真实登录 UI smoke。实现无 platform cfg，自动化覆盖 shared code path；平台实机证据留给 Release/manual QA，不在本记录中伪造。

## 2026-08-25/26 Fresh-device product prepare convergence

> **2026-08-26 follow-up：本节初次 closure 被真实目视反馈推翻。** 文件/ledger activity 只能证明最终 AppShell mount，不能证明中途未出现 terminal error。用户连续两次 fresh-device 流程都看到 `serviceUnavailable`，点击 retry 后成功；500ms/2-attempt budget 明显短于第二次实测的约 22 秒（Kimi `01:41:23`、managed config/vault `01:41:45`）。§16.43 已重新打开，以下原“无需人工 retry”结论不再作为通过证据；新 closure 以最多 6 次/约 30 秒 backoff + stage diagnostics + 用户不点击的目视复测为准。

> **2026-08-26 second follow-up：等待时长判断再次被现场证据纠正。** 本次 diagnostics 只记录一次 `code=protocolMismatch, stage=productPrepare, attempt=1, maxAttempts=6`，证明前端 retry helper 按设计未重试 non-transient protocol error；用户点击 retry 后立即 ready。该序列符合 managed key create 已完成 server-side side effect、首次 response 无法被 Native 信任、第二次 prepare 从 authoritative list 找到 key并 handoff 的 outcome-unknown 缺口。closure 改为 Native create reconcile + fresh-device 无点击目视复测；单纯扩大前端等待窗口不构成修复。

> **2026-08-26 closure：真实 fresh-device 无点击复测通过。** 停止原 hot 进程后，将 `.doge`、canonical bundle App Support/Cache/WebKit/Preferences 全部移入独立可恢复备份，卸载 npm global Kimi，并在启动前确认 `KIMI_ABSENT=1`、`DOGE_CONFIG_ABSENT=1`、`LOGIN_CREDENTIAL_ABSENT=1`。随后以 exact `npm run tauri:dev:hot` 启动 `target/debug/doge`，用户完成登录且不点击 Retry；managed-key create outcome reconcile 与 product prepare 后直接进入 AppShell，未再出现“服务暂时不可用”。随后 semantic rebase 到 latest main，Kimi provisioning 改为 main 已合入的 bundled managed toolchain；Native reconcile 路径不变，bundled/no-npm 行为由 focused tests 验证。§16.43 据此收口。

- Verification level：`L3 Cross-layer / High-risk`。最高触发项为 authenticated startup Gate、bundled managed toolchain、Tauri response ambiguity、remote managed prepare idempotency 与 generation cancellation；未修改 Rust command/schema、engine registry、Shared set、Provider binding identity、vault或数据库。
- 现场证据：首次 fresh open 中 Kimi npm package/bin 已于 `20:21:44` 落地，但 Gate 随后展示 `serviceUnavailable`；用户手工 retry 后进入 App。原实现 `prepareProductEngineProvisioningV1` 对 Kimi dependency reject 统一 `catch -> serviceUnavailable`，`ProductAccountAppGate` 又在 toolchain success 后保留 `preparingEngine=Kimi` 并 single-shot 调用 remote `client.prepare()`，导致 side-effect truth、remote phase 与 UI attribution 混淆。
- 最终修复：Codex/Claude/Kimi 全部走 verified bundled managed toolchain，Kimi 不再触发 npm mutation。toolchain success 后清除具体 engine attribution；无 cooldown 的 `serviceUnavailable`/thrown bridge result 使用 `[0,1s,2s,4s,8s,15s]` 最多 6 次 bounded retry。managed-key create 的 `protocolMismatch`/invalid-success/transport-unknown 不交给 renderer 重试，Native 在同一次 prepare 内按 exact group + deterministic name + active status re-list，再经 Desktop handoff继续；generation stale、server cooldown与 non-retryable failure仍 fail closed。
- 结构复核：bounded retry pure helper 从 Gate component 抽到 `src/features/account/runtime/productPrepareRetry.ts`，避免大型 component 新 export 触发 Fast Refresh invalidation；`ProductAccountAppGate` 只负责 phase/state orchestration。
- Focused frontend：Settings/ModelSelect + Product provisioning/retry/parser/Gate 共 8 files / 183 tests PASS；其中 product-owned tests 覆盖三引擎 bundled/no-npm、external→bundled override、bundle failure、6-attempt schedule、genuine `protocolMismatch` 不由 renderer隐藏、continuous failure budget、cooldown、generation stale、safe stage diagnostics 与 remote phase heading。Rust `account::runtime::runtime_product_tests` 12/12 PASS，并分别通过 settings normalization 与 default-settings regression，覆盖 create exact response validation、reconcile exact active identity selector及 read/update/restore 三条持久化边界。
- Compile/static：targeted ESLint PASS；`npm run typecheck` PASS；exact account-enabled `cargo check --lib` 与 `cargo fmt --all -- --check` PASS（compile only reports repository baseline warnings）；`npm run check:runtime-contracts`、`npm run doctor:strict`、engine capability/adapter/model-catalog gates、OpenSpec strict、docs governance、large-file report 与 `git diff --check` PASS。`runtime_product.rs` 已拆为 730-line orchestration + 146-line `runtime_product_keys.rs`；fail-mode large-file gate 仍因 latest-main baseline 的 101 项 finding EXIT 1，但两个本次 product runtime 文件均不在 finding 中。
- 历史 pre-bundled cold-restore 只用于定位“副作用已提交、response 不可信”的错误分类，不再作为当前 Kimi provisioning contract。当前 contract 以 bundled toolchain tests + 本次 fresh-device Native reconcile 目视证据共同收口。
- 视觉证据分级：Computer Use 因本机 `/Applications`、build output 与多个 mounted DMG 共享同一 bundle id，拒绝猜测 `target/debug/doge` target；未打开旧包冒充截图。当前 hot 窗口由用户直接目视，automation 只声明已证实的 binary/config/AppShell activity。
- Engine Onboarding §0：existing Kimi B10 bundled toolchain behavior 与 Product Gate orchestration 发生变化；A identity、C capability、D renderer whitelist、E picker、F Shared、G Settings、H i18n 均未改。受影响 engine gates全部通过。
- 未运行 L4：全量 Vitest/Rust workspace、Windows/macOS packaged installer、签名/notarization与 Release smoke。shared TypeScript/Rust path 已覆盖，跨平台实机仍由 Release/CI 验证。
