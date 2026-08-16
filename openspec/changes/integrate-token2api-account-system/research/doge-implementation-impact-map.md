# doge Current Implementation Impact Map：token2api Account Convenience

> 角色：`codebase-researcher`（只读调查）
> 调查日期：2026-08-12
> 状态：current-code evidence；不是 implementation design 或写入授权
> Research question：在不建立第二套 contract、不影响 Local Mode 的前提下，doge current implementation 中哪些入口、feature slice、Tauri IPC、feature flag、i18n、测试与 Codex config/runtime pattern 可复用，哪些 shared files 必须串行单一 owner？

## 1. Evidence boundary 与结论等级

- **已证实**：由 current source、test、config 或 active spec 的 repo-relative path / symbol 直接支持。
- **推断**：基于 current dependency direction 给出的 likely impact；正式写入仍由 `solution-architect` / 对应 write owner 冻结。
- **未验证**：缺少 runtime、目标平台或尚未实现的 contract evidence，不能当作 capability 已存在。
- 本文遵循 current implementation 优先级；dated report 只作为历史风险信号，不当作 current metric。
- 2026-08-12 调查期间，其他协作者新增了 `research/v1-contract-freeze-review.md`。本文只读取并采用其 canonical naming，未覆盖该文件或其他现有变更。

## 2. Executive Impact Summary

1. **唯一固定入口已有最短接入点**：复用 `useSettingsModalState.openSettings(section, highlightTarget)`、lazy `SettingsView` 与 `initialSection` 解析；新增 Account section 不需要第二个 router 或第二个全局 dialog host。
2. **contextual entry 已有轻量 callback pattern**：`ModelSelect.handleOpenCliSettings -> onOpenCliSettings -> openSettings("providers")`。Account CTA 应只传入同一 Settings route intent，不能持有第二份 account state。
3. **Account 必须是隔离 feature slice**：建议 `src/features/account/**` 自持 contract、gateway、Mock/Real adapters、state、hooks、components、Account Lab 与 tests；composition root 只注入 gateway 与打开 route。
4. **Tauri command registration 是集中冲突区**：frontend wrapper、barrel、exact invoke test、Rust domain module、`command_registry::invoke_handler`、`lib.rs` module/state wiring 是完整链路；registry/lib/state 必须单一 owner 串行落盘。
5. **当前没有统一 feature-flag framework**：现有 static constants、localStorage/Vite override、Rust env kill switch 只能作为 precedence/opt-out pattern。Account 的 product flags、DEV-only Mock 与 Rust/platform kill switches需由正式 design 固定，components 不应自行读 flag。
6. **i18n 是十语言 namespace registry**：Account 应使用独立 `account.*` namespace；十个 locale index 是 shared registry，必须由一个 integration owner 统一修改，并配 parity/hardcoded scan。
7. **Codex current read/write/reload 只能复用 primitives，不能直接充当 recipe transaction**：current raw editor允许整文件写、跨文件 partial success，底层 generic write 不是 atomic/locked transaction；reload 与 file outcome 已分离但 UI 不是 plan/apply/receipt/recovery contract。
8. **现有 Codex CLI account 不是 app account**：`account_read`、`account_rate_limits`、threads hooks 和 CLI login switching 属于 workspace/Codex runtime identity，不能复用为 token2api `AccountGatewayV1` state，也不能沿用自动 usage read。
9. **根渲染红线**：Account state、usage polling、remote events和数组追加不得进入 `app-shell.tsx` 或 root threads reducer。flag off 时必须零 mount、零 network、零 listener；usage 只在 Account view open/explicit refresh 读取。

## 3. Relevant Specs / Rules

### 3.1 本 change 的 authoritative inputs

- `.trellis/tasks/08-11-integrate-token2api-account-system/prd.md`：冻结 Codex first recipe、Settings 唯一固定入口、contextual entry、pull-only quota/usage、Mock-first/parallel/late integration。
- `openspec/changes/integrate-token2api-account-system/proposal.md`
- `openspec/changes/integrate-token2api-account-system/design.md`
- `openspec/changes/integrate-token2api-account-system/specs/token2api-account-convenience/spec.md`
- `openspec/changes/integrate-token2api-account-system/research/v1-contract-freeze-review.md`：正式实现只使用 canonical chain：
  `AccountGatewayV1 -> RealAccountGatewayV1 -> AccountTransportV1 -> AccountBrokerV1 -> Token2ApiAuthorityV1`；Mock 为 `MockAccountGatewayV1`；唯一 semantic manifest 为 `ScenarioManifestV1`。`AccountService` 不是 code alias。

### 3.2 Current implementation rules

- Frontend：`.trellis/spec/frontend/{directory-structure,component-guidelines,hook-guidelines,state-management,type-safety,quality-guidelines}.md`
- Backend：`.trellis/spec/backend/{directory-structure,error-handling,logging-guidelines,database-guidelines,quality-guidelines}.md`
- Cross-layer：`.trellis/spec/guides/{cross-layer-thinking-guide,code-reuse-thinking-guide}.md`
- Settings UI：`docs/guides/ui/preference-settings-ui-guide.md`
- Codex provider runtime：`.trellis/spec/backend/codex-provider-scoped-runtime.md`
- Native/platform gate：`.trellis/spec/guides/native-webview-api-risk-gate.md`
- Root render historical risk：`docs/perf/render-jank-knife-experiments-2026-07-08.md`
- Settings navigation behavior：`openspec/specs/settings-navigation-consolidation/spec.md`（与 current code 存在下述 drift，不能盲抄）。

## 4. Entry Points 与 Current Execution Flow

### 4.1 Settings → Account fixed entry

当前 flow：

```text
app-shell.tsx
  -> useSettingsModalState()
  -> openSettings(section?, highlightTarget?)
  -> settingsOpen/settingsSection/settingsHighlightTarget
  -> renderAppShell.tsx (settingsOpen 时才 mount)
  -> lazyViews.tsx::SettingsView (React.lazy)
  -> SettingsView(initialSection, initialHighlightTarget)
  -> local activeSection / subsection state
```

Evidence：

- `src/features/app/hooks/useSettingsModalState.ts::{SettingsSection,SettingsHighlightTarget,useSettingsModalState,openSettings}`。
- `src/app-shell.tsx` owns the modal state and passes it through the shell composition。
- `src/app-shell-parts/lazyViews.tsx::SettingsView` uses `React.lazy`。
- `src/app-shell-parts/renderAppShell.tsx` only renders `<SettingsView>` when `settingsOpen` and passes `initialSection` / `initialHighlightTarget`。
- `src/features/settings/components/SettingsView.tsx` maps initial intent to local `activeSection` and renders sidebar/header/content。

Recommended impact（推断）：

- 在 canonical Settings section type 中增加 `"account"`，fixed sidebar只增加一个 Account item。
- `SettingsView` 只挂一个 lazy Account feature boundary；Account state/provider 不放入 `SettingsView` 大组件，更不放入 AppShell。
- contextual intent仍调用同一个 `openSettings("account", <optional closed subtarget>)`；若 v1 不需要稳定 subtarget，优先只传 `"account"`，避免过早扩大公共 deep-link contract。

### 4.2 Contextual entry reusable patterns（2 examples）

1. **Composer model selector → provider settings**
   - `src/features/composer/components/ChatInputBox/selectors/ModelSelect.tsx::handleOpenCliSettings` 调用 `onOpenCliSettings?.()` 后关闭 menu。
   - `src/app-shell-parts/useAppShellLayoutNodesSection.tsx::handleOpenCliSettings` 映射到 `openSettings("providers")`。
   - `src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx` 断言 callback 只触发一次。
   - 适用：token service/configuration surface 只发 route intent；不 importing gateway/store，不复制 Account dialog。

2. **Parent section + highlight target deep link**
   - `useAppShellLayoutNodesSection.tsx` 已用 `openSettings("agent-prompt-management", "agent-management")`、`openSettings("agent-prompt-management", "prompt-library")`、`openSettings("other", "mcp-skills")`。
   - `SettingsView.tsx` 对 `initialHighlightTarget` 做 closed switch 并选择 subsection。
   - 适用：若 contextual Account CTA 需要定位 Codex recipe 或 usage，先由正式 contract增加 closed target；不能传任意 string/route payload。

另有 `src/features/vendors/modelManagerRequest.ts` 的 `sessionStorage + CustomEvent` 与 `VendorModelManagerDialogHost.tsx` 全局 host pattern。它适合跨树唤起独立 vendor dialog，但 Account 已冻结为同一 Settings route/state，**不应**复制此模式形成第二 Account host；最多作为“事件是 wakeup、状态需权威 read”的参考。

## 5. Isolated Feature Slice Patterns

### 5.1 Current examples（3 examples）

1. **Computer Use**：`src/features/computer-use/{components,hooks,constants.ts}` 对接 `src/services/tauri/computerUse.ts` 和 `src-tauri/src/computer_use/**`；hooks 使用 `mountedRef + requestIdRef` 防 unmount/stale response 写回。
2. **Multi-Agent**：`src/features/multi-agent/{components,hooks,runtime,store,templates,types.ts,utils}`，feature-owned runtime/store/tests，公共出口为 `index.ts`。
3. **Browser Agent**：`src/features/browser-agent/{actions,annotations,capture,code-bridge,components,evidence,hooks,state,utils,visual-evidence}`，按行为子域拆分并 colocate tests。

适用边界：这些例子证明“feature-owned components/hooks/state/runtime/tests + narrow service boundary”可行；它们的 domain contract、flag 语义和 global mounting 不能原样复制到 Account。

### 5.2 Recommended new frontend slice（推断，名称须服从 frozen design）

```text
src/features/account/
  contracts/       # AccountGatewayV1, closed view/error/outcome types, scenario projection
  adapters/mock/   # MockAccountGatewayV1, deterministic stateful engine, virtual clock
  adapters/real/   # RealAccountGatewayV1, AccountTransportV1 runtime validation/mapping
  state/           # feature-local state machine/store; no AppShell/threads reducer writes
  hooks/           # view-scoped reads, generation/request fencing, explicit refresh
  components/      # Settings Account shell, auth/account/usage/config surfaces
  lab/             # DEV/test-only Account Lab and scenario controls
  tests/           # contract/import/no-native/no-network/parity/state transition gates
  index.ts         # minimal public surface
```

Composition should inject `AccountGatewayV1` once at the lazy Account boundary. Components import only product contracts/hooks. `MockAccountGatewayV1` and `RealAccountGatewayV1` must both satisfy the same port; renderer must not import token2api wire DTO、Rust persistence type、vault detail或raw config。

### 5.3 Recommended Rust slice（推断）

```text
src-tauri/src/account/
  mod.rs                 # narrow Tauri commands only
  broker/                # AccountBrokerV1 lifecycle/receipts/reconcile
  transport/             # credential-free safe IPC mapping
  token2api/             # Token2ApiAuthorityV1 fixed-origin wire client/mapper
  repository/            # account metadata/schema/migrations
  vault/                 # OS-vault-only secret boundary
  callback/              # system-browser callback/reset ownership
  config_recipe/         # immutable Codex recipe + plan/apply/recovery
  test_support/           # fake authority/vault/repository/fault injection
```

这是 ownership 建议，不表示上述 module 已存在。Current repository只有 `src-tauri/src/shared/account.rs`（Codex app-server account response mapper），不应复用其 generic `account` 名称/语义冒充 app account domain。

## 6. Tauri Command / IPC Registration Impact

### 6.1 Current complete pattern（3 examples / layers）

1. **Frontend command wrapper + exact mapping test**
   - `src/services/tauri/computerUse.ts`、`src/services/tauri/modelCatalog.ts`、`src/services/tauri/textFiles.ts` 封装 `invoke()`。
   - `src/services/tauri.ts` 是 shared barrel；`src/services/tauri.test.ts` 断言 command name 与 camelCase payload 的 exact mapping，例如 `reload_codex_runtime_config`、`file_read`、`file_write`。
2. **Rust domain command + central registry**
   - `src-tauri/src/computer_use/mod.rs`、`src-tauri/src/files/mod.rs` 暴露 narrow `#[tauri::command]`。
   - `src-tauri/src/command_registry.rs::invoke_handler` 集中 `tauri::generate_handler![]` 注册全部 commands。
   - `src-tauri/src/lib.rs` 声明 modules、构造 `AppState`/plugins，并安装 `command_registry::invoke_handler()`。
3. **Desktop/remote/daemon parity pattern**
   - `src-tauri/src/files/mod.rs::{file_read_impl,file_write_impl}` 在 remote mode 调 `remote_backend::call_remote`，本地走 `src-tauri/src/shared/files_core.rs`。
   - `src-tauri/src/bin/doge_daemon.rs` dispatch 同名 method，`daemon_state.rs` 再复用 `files_core`。

适用边界：first local trial 已明确 remote/daemon/web 非 blocker，因此 Account v1 不应为了“对称”先接 generic remote proxy；但 command naming、safe DTO mapping、registration test 与未来 adapter seam 可复用。尤其禁止实现 renderer-controlled arbitrary HTTP/filesystem proxy。

### 6.2 Likely Tauri write sites（推断）

- New owned files：`src/services/tauri/account.ts`（或 Real adapter 内部 transport module）、`src-tauri/src/account/**` 及其 colocated tests。
- Shared registration：`src/services/tauri.ts`、`src/services/tauri.test.ts`、`src-tauri/src/command_registry.rs`、`src-tauri/src/lib.rs`。
- State/dependencies if required：`src-tauri/src/state.rs`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。
- 只有在正式 scope 声明 daemon parity 时才改：`src-tauri/src/bin/doge_daemon.rs`、`src-tauri/src/bin/doge_daemon/daemon_state.rs`；首包不应默认扩大至此。

每个 command/event envelope 必须属于 frozen `AccountTransportV1`，Real adapter 做 runtime validation。Event只作 wakeup，consumer随后 authoritative read；不得把 callback/event payload 当 session/config terminal truth。

## 7. Feature Flag Current Patterns 与 Account Boundary

当前没有 central feature-flag service。可复用的是 precedence 和 isolation 思路，不是现有 key：

1. **Static frontend/Rust constants**
   - `src/features/computer-use/constants.ts::{ENABLE_COMPUTER_USE_BRIDGE,ENABLE_COMPUTER_USE_BRIDGE_ACTIVATION}`。
   - `src-tauri/src/computer_use/mod.rs::{COMPUTER_USE_BRIDGE_ENABLED,COMPUTER_USE_ACTIVATION_ENABLED}`，activation另有 env opt-out。
2. **Frontend local override → build env → legacy → default-on**
   - `src/features/multi-agent/runtime/featureFlag.ts::isMultiAgentEnabled`：localStorage、Vite current/legacy aliases、default true。
   - `src/features/messages/presentation/sharedProjection/dataSource.ts::isSharedProjectionDataSourceEnabled`：local override、build override、legacy override、default true。
3. **Rust env kill switch**
   - `src-tauri/src/agent_orchestration/support.rs::require_agent_enabled`：current/legacy env aliases，explicit negative disables。

Frozen design 已列出 product/platform flags（见 `design.md` rollout section）。Implementation建议：

- composition root一次性决定 account feature是否可挂载；off 时 sidebar/contextual entries均消失、feature slice不 mount。
- Rust每个高风险 capability（vault/callback/config mutation/runtime injection）独立 fail closed；renderer flag不能授权 native capability。
- `accountFrontendMock` 只能是 compile-time DEV/test graph；normal production reachable graph 中不存在 Mock selection，Real failure不得 fallback 到 Mock success。
- components 不读 `import.meta.env` / localStorage / Rust env；只消费 composition注入的 capability projection。
- 禁止沿用 current default-on 习惯作为 Account 初始 rollout 决策；正式 flag default由 frozen design/tasks owner明确。

## 8. i18n Current Pattern 与 Impact

### 8.1 Current facts

- `src/i18n/index.ts::{SupportedLanguage,SUPPORTED_LANGUAGES,localeLoaders,fallbackChains}` 当前注册 10 个 bundle：`zh`、`zh-TW`、`en`、`hi`、`es`、`fr`、`ja`、`ru`、`ko`、`pt-BR`。
- 每个 `src/i18n/locales/<lang>/index.ts` 通过 namespace import + object spread 汇总。例如 `en/index.ts` 分别引入 `multiAgent`、`noteCards`、`settings` 等。
- `src/i18n/locales/multiAgentLocaleParity.test.ts` 验证所有语言与 English key set 及 interpolation placeholders 一致。
- `src/i18n/locales/noteCardsLocaleParity.test.ts` 是更小型 parity 例子。
- `src/features/multi-agent/i18nHardcodedScan.test.ts` 扫描 feature user-facing code 的中文硬编码并使用窄 allowlist。

### 8.2 Recommended impact（推断）

- 新建十个 `src/i18n/locales/<lang>/account.ts`，统一根 namespace `account`；closed error code/stage/recovery 在 frontend exhaustive mapper 映射文案，backend/raw authority message不能作为 translation key或直接展示。
- 十个 locale `index.ts` 都需 import/spread `account`；这是 mirrored shared registry，应由单一 i18n integration owner 一次完成。
- 新增 `accountLocaleParity.test.ts` 校验 nested keys + placeholders；新增 feature hardcoded scan（或将 reusable scanner抽成 project helper，由对应 owner决定）。
- Account Lab/scenario labels也必须 i18n 或严格 DEV-only；不可因为是 Mock UI 就向 production component 写 hardcoded copy。

## 9. Codex Config Recipe：Current Read / Write / Reload Map

### 9.1 Target/home resolution patterns

- `src-tauri/src/codex/home.rs::resolve_workspace_codex_home` precedence：workspace `settings.codex_home` → worktree parent override → legacy `.codemoss` → default。
- `resolve_default_codex_home` precedence：`CODEX_HOME` env → `~/.codex`。
- `.trellis/spec/backend/codex-provider-scoped-runtime.md` 同时规定 disk profile和managed provider home的隔离：managed profile使用 app-local `codex-provider-homes/<providerId>/`，thread/session binding不能静默回落 disk。

结论：`readGlobalCodexConfigToml()` 的 global default path不等于 frozen Codex recipe的唯一正确 target。Recipe planner必须在 Rust 根据 installed immutable recipe、provider-scoped binding和platform policy解析 exact target；renderer/server不能传 path。

### 9.2 Current raw read/write pattern

```text
CurrentCodexGlobalConfigCard
  -> read/writeGlobalCodexConfigToml / read/writeGlobalCodexAuthJson
  -> textFiles.ts::fileRead/fileWrite
  -> Tauri file_read/file_write
  -> files/mod.rs -> shared/files_core.rs -> files/io.rs
```

- `src/services/tauri/textFiles.ts` 公开 global `config` / `auth` 整文件读写。
- `src-tauri/src/files/io.rs::{read_text_file_within,write_text_file_within}` 做 canonical-root、symlink/root policy 和 text decoding；`write_text_file_within` 最终直接 `std::fs::write`。
- `src/features/vendors/components/CurrentCodexGlobalConfigCard.tsx::handleSave`：只写 changed files；empty auth draft不会擦除 credential；多文件用 `Promise.allSettled`，允许 partial success，并保留 raw renderer draft/editor。
- `src/services/tauri.test.ts` 有 exact invoke mapping；`CurrentCodexGlobalConfigCard.test.tsx` 覆盖 editor behavior。

可复用：target allowlisting / canonical path thinking、changed-only、不要空写 secret、file outcome分别报告。不可复用为 recipe contract：renderer raw secrets/path/config、whole-file arbitrary content、direct write、并行 partial success都违反 frozen planner/transaction/receipt boundary。

### 9.3 Current semantic config mutation patterns（2 examples）

1. `src-tauri/src/codex/config.rs::{inspect_feature_flag,write_feature_flag,remove_feature_flag}` 及 `upsert_feature_flag_in_contents` / `remove_feature_flag_from_contents`：小范围修改 `[features].unified_exec` 并保留其他行、CRLF，有 unit tests。
2. `src-tauri/src/vendors/grok_providers.rs::vendor_save_grok_config_toml`：先 TOML validate，再 temp write + rename；Unix设置 `0600`。Kimi/OpenCode provider modules也有 replacement/cleanup tests。

这些证明“semantic transform + validate before replace + preservation tests”存在，但不是完整多文件 transaction。Codex recipe必须使用自己的 immutable catalog、fingerprint/digest、plan TTL、concurrent edit detection、Nth-file rollback/recovery和durable receipt；不能把上述 command扩成任意 recipe executor。

### 9.4 Stronger storage primitives

- `src-tauri/src/storage.rs::{with_storage_lock,write_bytes_atomically,write_string_atomically}`：lock file、stale lock handling、unique temp、`sync_all`、rename、failure cleanup。
- 可作为 implementation building blocks 的 evidence；正式 owner仍需验证 Windows replace语义、目标配置权限、directory fsync、multi-file recovery与crash points，不能直接声称 transaction已满足。

### 9.5 Current reload pattern

- `src/services/tauri/settings.ts::{CodexRuntimeReloadResult,reloadCodexRuntimeConfig}` 调 `reload_codex_runtime_config`。
- `src-tauri/src/settings/mod.rs`：使用 `state.codex_runtime_reload_lock`；snapshot connected sessions，先 stage所有新 sessions；任一 spawn失败会终止已stage sessions并返回 error；全部stage后逐一 swap；无 connected session返回 `status=applied, stage=noop, restartedSessions=0`。
- `src/services/tauri.test.ts` 断言 command mapping。

可复用：single-flight lock、stage-before-swap、noop semantics、file outcome与reload outcome分离。限制：current return types仍以 free-form `status/stage/message` 表达，swap loop并非 frozen recipe receipt/recovery contract；existing thread provider binding与“only future new sessions”语义必须服从 provider-scoped runtime spec。Recipe apply成功但reload失败时，不能伪称files rollback，也不能把file write成功和runtime验证成功合并成一个 boolean。

## 10. Existing Codex Account / Quota：明确不可混用的边界

Current code 已有名为 account 的链路，但它是 **Codex CLI/app-server account**：

```text
modelCatalog.ts::{getAccountInfo,getAccountRateLimits,runCodexLogin,cancelCodexLogin}
  -> Tauri account_read/account_rate_limits/codex_login/*
  -> codex/mod.rs
  -> shared/codex_core.rs::{account_read_core,account_rate_limits_core,codex_login_core}
  -> Codex app-server account/read + account/rateLimits/read or Codex CLI login
```

- `src/features/threads/hooks/useThreadAccountInfo.ts` 把 response normalize 为 thread-domain `AccountSnapshot`，写入 `accountByWorkspace`。
- `src/features/threads/hooks/useThreadRateLimits.ts` 把 Codex limits normalize 后写入 `rateLimitsByWorkspace`。
- 两个 hooks 都在 workspace connected effect 中主动 refresh，并把 raw request/response 发到 debug callback。
- `src/features/app/hooks/useAccountSwitching.ts` 调 `runCodexLogin` / `cancelCodexLogin` 完成 Codex CLI account switch。
- `src/features/threads/hooks/useThreadsReducer.ts` 与 `threadReducerTypes.ts` 持有 root-level `accountByWorkspace` / `rateLimitsByWorkspace`。

这套链路可以作为 invoke/error/loading/test pattern evidence，但不能成为 token2api app account model：

- identity authority、credential lifecycle、scope（workspace vs app/account/device）不同；
- current automatic connect-time usage read违反首期 pull-only policy；
- root reducer写入与 raw debug response不满足 Account isolation / secret-minimized boundary；
- 名称冲突风险高，新代码必须使用 frozen `AccountGatewayV1` 和明确 app-account namespaces，不能复用 `AccountSnapshot`。

## 11. Shared / Root Render Risks

### 11.1 Current high-cost roots

- `src/app-shell.tsx`：约 2492 lines。
- `src/app-shell-parts/useAppShellLayoutNodesSection.tsx`：约 2484 lines。
- `src/features/settings/components/SettingsView.tsx`：约 2406 lines。
- `src/app-shell-parts/renderAppShell.tsx`：约 791 lines。

`docs/perf/render-jank-knife-experiments-2026-07-08.md` 曾测到 AppShell 根渲染单次主线程阻塞 100–350ms，并记录 `react-scan` 约 2–3x 放大、`memoizedUpdaters` 追踪、30s fallback polling 和 `liveAssistantTextChannel` 外部化。该数值带日期，**不是 2026-08-12 current measurement**；Account 接入前后须重新测量。

### 11.2 Blocking integration guardrails

- 不把 Account gateway、session、usage、scenario history、receipt list放入 `app-shell.tsx` state或 threads reducer。
- 不在 root hook chain做 app-start bootstrap、vault probe、remote capability fetch、session refresh或usage fetch。
- feature flag off：零 entry、零 slot、零 provider/store mount、零 IPC/network、零 event listener。
- Account view打开时才 lazy construct feature boundary；auth/session restore也必须由冻结的 feature lifecycle触发，不能阻塞 Local Mode startup。
- usage只在 user opens usage view或明确 refresh读取；event/invalidation只标 stale/needs-read，不自动 fetch。
- async hooks必须带 generation/request fencing；切 account、关 modal、scenario reset、logout后旧 response不得写新 state。`useComputerUseBridgeStatus` 的 `mountedRef/requestIdRef` 是current example。
- array append/log/transition history留在 feature-local external store或DEV Lab，禁止通过 root props每事件更新。
- contextual entry只透传稳定 callback/intent；不向 composer/model selector传整个 Account state或gateway。

## 12. Settings Spec / Current Code Drift（需 lead/architect知情）

`openspec/specs/settings-navigation-consolidation/spec.md` 要求：

- `shortcuts` 不再是一级 public Settings section，仓库不得保留 `openSettings("shortcuts")`；
- `Runtime Environment` 应作为可见父入口。

Current code事实相反：

- `useSettingsModalState.ts` 和 `settingsViewAppearance.ts` 仍暴露 `"shortcuts"`；
- `useAppShellLayoutNodesSection.tsx` 仍调用 `openSettings("shortcuts")`；
- `SettingsView.tsx` 显示 standalone shortcuts sidebar item；`SettingsView.test.tsx` 明确断言它存在；
- `SettingsView` 能处理 `runtime-environment` / highlight target，但 sidebar没有 Runtime Environment item；test明确断言它不存在。

本文按项目优先级采用 current code作为 implementation impact事实，不在 Account task顺手修此 drift。Account owner应避免把现存 duplicated section union继续扩散，并由 documentation/governance owner另行裁决主 spec同步，不应让这个 drift阻塞 Account route本身。

## 13. Likely Files / Modules by Delivery Lane

### 13.1 Frontend feature owner（new isolated files）

- `src/features/account/**`：contracts、Mock/Real adapters、feature state/hooks/components、Account Lab、tests。
- `src/styles/settings.account.css` 或 feature-scoped equivalent；如果仍由 Settings bundle加载，则只在专属 CSS slice中写 Account selectors。
- `src/i18n/locales/{zh,zh-TW,en,hi,es,fr,ja,ru,ko,pt-BR}/account.ts`。

### 13.2 Frontend integration owner（shared files，串行）

- `src/features/app/hooks/useSettingsModalState.ts`
- `src/features/settings/components/settings-view/settingsViewAppearance.ts`
- `src/features/settings/components/SettingsView.tsx`
- `src/features/settings/components/SettingsView.test.tsx`
- `src/app-shell-parts/lazyViews.tsx`
- `src/app-shell-parts/renderAppShell.tsx`
- `src/app-shell-parts/useAppShellLayoutNodesSection.tsx` 及其 tests（只有 contextual call-chain确需穿透时）
- contextual source component/tests（具体 token service/config surface须由 product/design owner点名，不能全库散播 CTA）
- `src/styles/featureStyleLoaders.ts` / `.test.ts`、`src/styles/settings.css`（仅在新增 lazy style slice需要注册时）

### 13.3 i18n integration owner（shared mirrored registries）

- 十个 `src/i18n/locales/<lang>/index.ts`
- `src/i18n/locales/accountLocaleParity.test.ts`
- account hardcoded-copy scan；通常无需改 `src/i18n/index.ts`，除非新增语言或 loader semantics。

### 13.4 Backend broker / platform / storage owners

- `src-tauri/src/account/**`（new domain ownership按正式 task拆分）
- `src/services/tauri/account.ts` 或 feature real adapter transport module
- Shared integration：`src/services/tauri.ts`、`src/services/tauri.test.ts`、`src-tauri/src/command_registry.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/state.rs`
- Dependency surface：`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`
- Codex recipe owner only：`src-tauri/src/codex/{home.rs,provider_profile.rs,session_runtime.rs,...}` 中确有必要的 target/runtime binding sites，以及相关 provider-scoped tests。
- 若 storage schema使用新 DB/repository，migration/schema文件必须由 data-storage owner单一持有；不得塞入现有 generic files/storage API。

## 14. High-conflict Shared Files：必须单一 owner

| Conflict zone | Files | 原因 / ownership rule |
|---|---|---|
| Canonical contract | canonical TS/Rust schemas、scenario manifest/validators | `AccountGatewayV1`、`AccountTransportV1`、closed unions、`ScenarioManifestV1` 只能一个 contract owner；各 lane只生成 projections。 |
| Settings route/type | `useSettingsModalState.ts`、`settingsViewAppearance.ts` | 当前已存在 duplicated union；同一 integration owner同时改并加 drift guard。 |
| Settings composition | `SettingsView.tsx`、`SettingsView.test.tsx`、`lazyViews.tsx` | 巨型 shared UI、入口顺序、lazy mount与现有 tests容易冲突。 |
| AppShell prop chain | `app-shell.tsx`、`renderAppShell.tsx`、`useAppShellLayoutNodesSection.tsx` | 根渲染性能和大 prop graph；只给 frontend integration owner，feature agents不得并行编辑。 |
| Frontend IPC registry | `src/services/tauri.ts`、`src/services/tauri.test.ts` | shared barrel与一个大 exact-mapping suite；由 IPC integration owner批量注册。 |
| Rust command/module/state | `command_registry.rs`、`lib.rs`、`state.rs` | 全 app central registration/construction；Backend integration owner串行。 |
| Rust dependencies | `Cargo.toml`、`Cargo.lock` | Vault/HTTP/DB/plugin dependencies会同时触发；dependency owner一次合并，禁止多个 lane改 lockfile。 |
| Locale registries | 十个 locale `index.ts` | mirrored update sites；i18n integration owner一次性加 namespace并跑 parity。 |
| Style registries | `featureStyleLoaders.ts`、test、`settings.css` | lazy CSS顺序与共享 Settings bundle；一个 frontend integration owner。 |
| Codex recipe/runtime | `codex/home.rs`、provider profile/session launch、settings reload | provider-scoped binding/security/perf契约高风险；Codex recipe owner独占，engine/backend agents等待其 API。 |

同一 shared file不得并行写。尤其不应把“Frontend Experience”和“Settings integration”都授权修改 `SettingsView.tsx`，也不应让 Broker/Vault/Config三个 backend worker分别注册 commands或改 `Cargo.lock`。

## 15. Recommended Write Ownership / Integration Order

### Phase 0 — contract assets first（single owner）

- `quality-engineer` / designated contract owner冻结唯一 `ScenarioManifestV1` semantics 与 validators；Frontend、Broker、token2api lanes只维护derived projection，不各自发明 scenario IDs。
- Frontend contract owner冻结 `AccountGatewayV1` composed ports与closed renderer-safe models。
- Broker contract owner冻结 `AccountTransportV1` / `AccountBrokerV1` safe envelopes、intent/operation/reconcile semantics。
- 在这一步完成前，不允许 Settings、Tauri registry或Codex runtime integration写入。

### Phase 1 — disjoint lanes may run in parallel

| Lane | Exclusive write ownership | Must not edit |
|---|---|---|
| Frontend Experience | new `src/features/account/**`、new account locale leaf files、feature-local CSS/tests | Settings/AppShell shared files、Tauri barrel/registry、Rust、locale indexes |
| Doge Broker Core | new `src-tauri/src/account/**` excluding shared registration、feature-local Rust tests | `command_registry.rs`、`lib.rs`、`state.rs`、Cargo lock、Codex runtime files |
| Storage/Vault specialist | broker-owned repository/vault submodules under an explicit non-overlap list | command registration、config recipe、frontend |
| Codex Recipe/Transaction | broker config-recipe submodule plus explicitly assigned Codex target/runtime files | Account UI、Settings、generic files API、other provider semantics |
| token2api lane | token2api repository only; consumes authority contract | doge files |
| Test automation | canonical scenario validator/harness and disjoint test-support files | production shared registries unless lead assigns integration |

### Phase 2 — serialized doge integration zones

1. **Dependency integration owner** merges native dependencies and the single `Cargo.lock` result。
2. **Backend IPC integration owner** wires `state.rs -> lib.rs -> command_registry.rs` and frontend Tauri wrapper/barrel/test in one serialized change。
3. **i18n integration owner** updates all ten locale indexes and parity test after leaf translations exist。
4. **Frontend Settings integration owner** adds canonical Settings Account route, lazy mount, sidebar and only approved contextual callbacks/tests；does not relocate feature state into root。
5. **Codex recipe/runtime owner** integrates target binding, plan/apply/recovery and reload semantics only after Broker contract/conformance is green。
6. Late Integration replaces Mock composition with Real only after both conform；production build includes a negative proof that Mock/Account Lab is unreachable。

### Phase 3 — independent verification / review

- `quality-engineer` aggregates semantic manifest runs、Local Mode regression、Mock/Real conformance与build evidence。
- `security-privacy-reviewer` owns vault、callback、secret-negative、config mutation、logging/support-bundle verdict。
- `performance-reliability-reviewer` remeasures Settings open、Account view state transitions和background/closed state，确认无 root render/polling regression。
- `change-reviewer` / framework reviewers independently review actual diff；lead对shared file ownership和code/spec drift做semantic integration。

## 16. Test Patterns 与 Required Validation Points

### 16.1 Current reusable test patterns（3 examples）

1. **Exact IPC mapping**：`src/services/tauri.test.ts` asserts command name/payload，适合所有 `AccountTransportV1` wrapper calls。
2. **Feature-colocated async tests**：`src/features/computer-use/hooks/useComputerUseBridgeStatus.test.tsx` 覆盖 enabled/disabled、refresh、stale/unmount；适合 Account generation fencing 与 pull-only reads。
3. **Source/contract guards**：`multiAgentLocaleParity.test.ts`、`i18nHardcodedScan.test.ts`、`featureStyleLoaders.test.ts` 读取源码或bundle验证 mirrored contracts；适合 forbidden imports、Mock production exclusion、locale parity、no network/native during Mock review。

### 16.2 Account-specific acceptance points

- **Entry**：Settings Account存在且为唯一 fixed entry；contextual CTA只进入同一 route/state；flag off无 entry/empty slot。
- **Mock isolation**：Mock scenarios中真实 `fetch`、Tauri `invoke`、OS/native calls均为 zero；unknown scenario closed failure，reset/seed/advance/failure injection deterministic。
- **Gateway/transport**：Mock与Real compile against one `AccountGatewayV1`；Real runtime-validates transport；closed unions exhaustive；forbidden imports fail tests。
- **Usage**：mount Account root不自动读usage；仅打开usage view/explicit refresh调用一次；close/switch/generation change抛弃stale response；无 timer/background notices。
- **Tauri/Broker**：command mapping、unknown field/enum、redaction、idempotency/reconcile、vault unavailable、callback replay、lost response、epoch fencing、cancel/timeout ambiguity。
- **Codex**：target resolution、manual preservation、malformed/conflict/already configured、plan expiry、concurrent edit、Nth-file failure、rollback incomplete、durable receipt、reload failure/noop、existing thread unchanged、new runtime binding正确。
- **Local Mode**：flag off、logged out、vault locked、authority outage、quota exhausted、session revoked时existing workspace/conversation/engine/file/Git/terminal flows不受影响。
- **Root performance**：Account closed/off/background状态无 new root timers/updaters；正式测量关闭 `react-scan`，归因时记录其放大效应。

## 17. Test / Build Commands for Downstream Implementation

以下是 current repository可执行入口；具体新增 test path需由实现 owner替换占位路径：

```bash
# Focused frontend feature + integration
npx vitest run src/features/account
npx vitest run src/features/settings/components/SettingsView.test.tsx
npx vitest run src/app-shell-parts/useAppShellLayoutNodesSection.test.ts
npx vitest run src/services/tauri.test.ts
npx vitest run src/i18n/locales/accountLocaleParity.test.ts
npx vitest run src/styles/featureStyleLoaders.test.ts

# Frontend static/build gates
npm run typecheck
npm run lint
npm run check:runtime-contracts
npm run build

# Rust focused and compile gates
cargo test --manifest-path src-tauri/Cargo.toml account
cargo test --manifest-path src-tauri/Cargo.toml codex
cargo test --manifest-path src-tauri/Cargo.toml --no-run

# OpenSpec / repository hygiene
openspec validate integrate-token2api-account-system --strict --no-interactive
git diff --check
```

Late-integration/package gate还需目标平台 install/launch、system-browser callback、vault、config transaction、Codex new-session binding的实机 evidence；仅 `npm run build` / `cargo test` 不足以证明可试用包完成。

## 18. Internal / External Dependencies

### 18.1 Current reusable dependencies

- `reqwest`、`rusqlite`、`serde`、`tokio`、`uuid`、`toml`、`sha2` 已在 `src-tauri/Cargo.toml` direct dependencies中；这只表示building blocks存在，不证明 Account authority/repository/transaction已实现。
- Tauri opener/dialog/process、existing event/IPC、Codex provider-scoped runtime、generic file policy/atomic storage primitives可作为narrow基础。

### 18.2 Missing or gated capabilities

- `Cargo.toml` 未声明明确的 cross-platform OS vault abstraction（例如 direct keyring adapter）；`Cargo.lock` 中 transitive platform security package不构成 doge vault implementation evidence。
- 未找到 app-account repository/ledger/schema/migration；existing SQLite usage不是 Account persistence contract。
- 未找到完整 desktop deep-link/single-instance callback broker。`src-tauri/src/lib.rs` 的 macOS `RunEvent::Opened { urls }` 当前只处理 `file:` paths；`tauri-plugin-opener` 不等于 callback ownership/replay protection。
- 未找到满足 frozen contract的multi-file config planner/apply/receipt/recovery implementation；generic file write和storage atomic write只是局部primitive。
- External blocking dependencies包括 token2api authority gap closures、guarantee descriptor、managed-key one-time secret lifecycle、Desktop OAuth/reset completion与目标deployment policy；以 design gap matrix为准。

## 19. Risks / Unknowns / Required Next Decisions

### 已证实风险

1. Settings section type在两个文件重复定义，新增 Account若只改一处会compile/runtime drift。
2. AppShell/Settings/IPC test/command registry均为large shared files，parallel writes高冲突且会放大render/perf风险。
3. Current raw Codex config editor允许renderer看到/编辑auth content并发生multi-file partial success；不能被包装成“one-click transaction”。
4. Current Codex account/usage hooks自动在workspace连接时读取并写root reducer；不能用于pull-only app account usage。
5. Current Settings main spec与code/test存在shortcut/runtime navigation drift；Account integration需current-code aware，治理另案收口。

### 未验证（blocking before enabling affected capability）

1. **Exact contextual surface**：产品只冻结“token service/configuration context”，尚未在 current doge code中点名唯一 component/symbol。Frontend/design owner应从实际 Codex provider/config journey选择最小 CTA site，禁止多个团队自行散播入口。
2. **Codex canonical target**：managed profile exact platform path、manual config collision、existing provider record semantics、credential env injection key和new-session binding仍需current version/platform evidence；`design.md` platform matrix也标为 unverified。
3. **Vault/platform**：macOS/Windows/Linux vault API、locked/unavailable语义、ACL、upgrade/uninstall、backup/restore和key migration均未验证。
4. **Callback ownership**：scheme/loopback choice、single-instance forwarding、app-not-running、late/replayed callback、firewall/port collision尚无 current implementation evidence。
5. **Safe replace**：Windows replacement、permissions、directory durability、crash recovery、Nth-file rollback和receipt fsync需fault-injection +实机证明。
6. **Flag transport**：frozen flag names/semantics已在 design中定义，但current code没有Account flag registry/config pipeline；default、build/runtime source及remote guarantee组合需tasks落地。
7. **CSS loading**：Account content若只存在Settings内可沿用 `loadSettingsStyles`；若 contextual modal必须在Settings外render，则需独立 style loader。由final surface composition决定，不能先把整个 settings.css全局化。
8. **Existing plaintext Codex providers**：current managed provider profile可含 `authJson`。Frozen design明确v1不自动迁移；recipe owner必须证明不copy、不claim为account-managed key。
9. **Performance baseline**：2026-07-08历史数值必须重测；未有Account integrated current metric。

## 20. Handoff Verdict

Current code足以支持一个低耦合实施路径：以 `SettingsView` lazy section作为唯一fixed composition point，以现有 callback→`openSettings`模式提供contextual entry，以独立 `src/features/account/**` + `src-tauri/src/account/**` slice实现 canonical v1 chain，并只在late integration阶段串行触碰Settings/AppShell/Tauri registry/Codex runtime shared zones。

不应复用或扩展成目标contract的部分是：Codex CLI `AccountSnapshot`/auto rate-limit hooks、global raw config editor、generic `file_write`、vendor dialog第二host、以及任何root-level polling/state。下一步应由 `solution-architect` 把本文的current facts与 `v1-contract-freeze-review.md` 合并成正式 Technical Design / task ownership；所有 unverified platform/security/config items在对应flag enable前保持fail closed。
