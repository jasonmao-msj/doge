# Provider-Scoped Model Catalog Contract

## Scenario: 新会话供应商绑定驱动模型目录

### 1. Scope / Trigger

- Trigger：修改 Claude Code、Codex、Kimi、Grok 或 OpenCode CLI 的新会话 provider binding、模型菜单、`get_engine_models`、provider config resolver、Shared Session target validation 或 Desktop/daemon bridge。
- 目标：已绑定 provider 的 thread 只能读取该 provider 配置模型，并追加 public models；禁止回退到其他 provider 或 global managed config。

### 2. Signatures

```typescript
getEngineModels(
  engineType: EngineType,
  options?: {
    forceRefresh?: boolean;
    providerProfileId?: string | null;
  },
): Promise<EngineModelInfo[]>
```

```rust
#[tauri::command]
pub async fn get_engine_models(
    state: State<'_, AppState>,
    engine_type: EngineType,
    provider_profile_id: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Vec<ModelInfo>, String>
```

```rust
pub(crate) fn get_provider_scoped_engine_models(
    engine_type: EngineType,
    provider_profile_id: Option<&str>,
) -> Result<Option<Vec<ModelInfo>>, String>
```

```rust
pub(crate) fn get_local_engine_models_for_validation(
    engine_type: EngineType,
) -> Option<Vec<ModelInfo>>
```

Response origin field：

```typescript
type EngineModelInfo = {
  id: string;
  model?: string;
  providerProfileId?: string | null;
};
```

### 3. Contracts

- `providerProfileId` omitted/blank：保持 legacy engine-global catalog。
- local/disk sentinel：resolver 返回 `None`，保持对应 CLI 的本地配置行为。
- managed provider：只读取该 provider profile 的 model fields/custom models，不读取其他 provider 或默认 managed config。
- Claude/Kimi/Grok managed provider models 必须先于 public generated/built-in models 合并；按 runtime `model` identity 稳定去重，provider row 获胜。
- **Codex managed provider 例外**：`get_provider_scoped_engine_models(EngineType::Codex, Some(profile))` MUST 只返回该 profile 配置/发现/用户管理的 rows，MUST NOT 拼 official generated fallback。Official fallback 是 upstream/provider capability，不是任意 relay binding 的事实；空 scoped catalog 走 configured-default/custom guidance。Product mode 继续读取 endpoint protocol → `projectProductTargetCatalogV1`，不得借此例外隐藏或复制 Product row。
- catalog entry `id` 是 UI/selection identity，`model` 是 CLI/API runtime identity。
  Picker/Target snapshot 必须分域保存；send/continuation execution MUST 只消费 runtime
  `model`。legacy entry 缺少 `model` 时允许显式 compatibility fallback；已知
  `id != model` 时禁止把 `id` 发送给 runtime。
- Provider Continuation backend 在 target side effect 前 MUST 用相同 Provider-scoped
  catalog 校验 `modelCatalogEntryId + model`。明确命中 UI-only id 时返回
  `invalid-target-model`；未命中 catalog 的 non-empty custom runtime model 继续按
  shape-only passthrough，禁止引入 official allowlist。
- frontend 将 provider-scoped Codex rows 投影到 Composer 时，MUST 仅按 normalized runtime `model` identity 从权威 Codex catalog 补缺 reasoning capability；MUST NOT 覆盖 provider-owned metadata，也不得为 unmatched provider-only model 伪造 capability。
- active provider-bound Codex thread 的非空用户模型名 MUST 直接保留，不得经过 current/global catalog 白名单校验；catalog loading/refresh/absence 不得触发默认模型 repair 回写。blank value 继续走既有 fallback。
- active provider-bound Claude Code thread 采用相同的 non-empty thread model truth contract；catalog loading/refresh/absence 不得重置 model 或 reasoning effort。blank value 继续走既有 fallback。
- public custom model 的 `providerProfileId` 为 `null`；可追加到当前 provider catalog。
- Codex localStorage custom model 若属于其他 `providerProfileId`，Composer 必须过滤。
- Desktop remote forwarding 与 daemon dispatch 必须原样透传 `providerProfileId`。
- frontend cache/dedupe/request identity 必须包含 `engineType + providerProfileId`；旧 scope 晚返回不得覆盖当前模型菜单。
- Shared Picker 根菜单只加载 Provider Profile；具体 Model catalog 必须在用户展开 CLI
  后按 binding lazy load。一个 Profile 失败不得阻塞其他 CLI/Profile。
- Shared Picker 展开 local/disk Profile 时必须绕过 completed module cache，并以
  `forceRefresh: true` 重读当前 binding 的 configured catalog；同 scope 的 concurrent
  request 仍必须合并。同一 picker catalog owner 首次成功刷新后，pointer / focus /
  accordion 的重复 activation 必须复用已完成结果，不得反复进入 loading。加载期间禁止
  暴露旧 Shared local model row 供点击；Native 单栏的 last-good rows 不受此策略影响。
- Provider selected state 以 `engine + normalized providerProfileId` 为 identity；
  `providerProfileSource` 是 metadata，Native synthesized target 未携带 source 时不得丢失
  Provider / Model 勾选态。
- catalog row 的 runtime `model` 为空时，frontend MUST 与 backend validation 一致，
  使用非空 catalog `id` 作为 compatibility runtime model；已知 `id != model` 时仍 MUST
  使用明确 runtime `model`，不得把 UI id 误发给 runtime。
- local/disk sentinel 可以传给 `getEngineModels` 解析本地配置，但写入 Shared
  `ExecutionTarget` 前必须归一为 `providerProfileId = null`。
- 切换 Target 后当前 Model label 必须从目标 Provider catalog 解析，禁止继续消费旧
  Engine 的 `models` prop。
- missing/invalid managed provider 必须返回可诊断 error；禁止静默回退 global catalog。
- Shared supported Engine allowlist、local validation catalog、managed provider catalog、
  create/persistence validation、V2 turn revalidation 与 Projection availability 是一个
  capability propagation matrix。新增 Shared CLI 时 MUST 同批核对所有入口；只让
  Picker 可见不等于 Runtime 已接入。
- Kimi/Grok/OpenCode canonical local Target 必须通过
  `get_local_engine_models_for_validation` 读取对应 CLI authority：Kimi/Grok 使用当前
  local config + generated fallback，OpenCode 使用 generated public catalog 基线。
  Shared create 与 V2 turn MUST 继续执行 strict
  `modelCatalogEntryId + runtime model` pair validation，禁止用 shape-only passthrough
  掩盖缺失 catalog。
- Shared Projection 对五种 supported CLI 必须使用同一 Engine allowlist。managed
  provider lookup 的 `Ok(None)` 表示 catalog authority 不存在，`providerAvailable`
  MUST 为 `false`；禁止把“查询过程没有报错”误判为“Provider 可用”。
- Codex managed provider 的 create-session/model-omitted send fallback 必须读取同一 profile 的 top-level `configToml.model`；仅 disk profile 可读取 workspace/default model。
- Codex provider name 只是 display metadata；名称为 `Kimi` 不得改变 `engine=codex` routing。
- Provider catalog 的显式动作必须分离：`Reload Config` 重新读取持久化配置，
  `Discover Models` 只允许调用对应 CLI 的模型发现协议。禁止用 HTTP provider API、
  CLI `--help` 文本或静态默认值伪装 discovery。
- `Discover Models` 仅在当前 runtime 具备可信 CLI discovery protocol 时显示；当前
  Codex 使用 binding-scoped app-server `model/list`。Claude Code 等无稳定协议的
  runtime 不显示该动作。
- 两个动作都必须更新当前 Provider Binding 的模型框，并按 runtime `model` identity
  合并 custom/configured/discovered rows；custom row 优先，任一动作失败时保留
  last-good catalog 与当前 selection。
- Native 单栏与 Atomic 双栏（Shared / Home create-session）可以共享
  `engine + providerProfileId` keyed cache/request primitives，但必须使用独立 hook state
  owner 与互斥 input contract。Native owner MAY 接收当前 Session 的 `currentModels`，
  并且只能投影到当前 CLI/Profile；Atomic owner MUST NOT接收或投影
  `currentModels`，所有 Profile rows 只能来自对应 binding-scoped catalog。
- Native 单栏与 Atomic 双栏必须分别持有 expanded Profile / active CLI UI state。
  Shared 或 Home Profile B 的展开、加载与 action 不得刷新 Profile A，不得改写 Native
  selection，也不得把其他 managed Provider 或 Local settings override 放入当前
  managed Provider。
- Backend managed catalog 返回 `providerProfileId = null` 且 `source = fallback | builtin`
  的合法 public fallback 时，Native 单栏与 Atomic 双栏都 MUST 保留这些 rows。Atomic
  managed Profile 只允许当前 `profile.id` 的 scoped rows 加该 engine contract 允许的
  public fallback；**Codex managed Profile 不允许 official generated fallback**。其他无
  binding identity 的 Local/config rows 只允许出现在 local/disk Profile。
- Profile catalog loader MUST 按 canonical local sentinel（以及 backend
  `isLocalProvider` metadata）保持 local Profile 的 `source = disk`。Backend
  返回 local sentinel 不得因经过统一 Provider normalization 被重分类为
  `managed`；否则 Picker 会形成非法的 `providerProfileId = null + source =
  managed` target，并被 resolved target gate 拒绝。
- Atomic 双栏的 CLI row、Provider Profile header 与 Model row MUST 仅由 primary
  click 改变 active/expanded/selected state；pointer hover/focus 不得切换 CLI，
  `pointerdown` 不得提前提交 Model。Native 单栏继续遵循既有 submenu contract。
- Home create-session 的完整 `ExecutionTarget` MUST 保持 Composer-local。位于
  Composer 外部的 hero Engine icon MUST 消费当前 creation target 的低频 Engine
  projection，不得继续读取可能滞后的 global `selectedEngine`；禁止为标题回显上提
  Provider/Model/Reasoning 或整份 draft target。

### 4. Validation & Error Matrix

| 输入/状态 | 结果 | 禁止行为 |
|---|---|---|
| `providerProfileId` omitted | 对应 CLI local validation catalog | supported CLI 返回 `None` 或绕过 strict pair validation |
| local/disk sentinel | CLI 本地配置模型 | 当作 managed provider 查询 |
| valid Claude/Kimi/Grok managed provider | provider models + public models，整体去重 | 混入其他 provider models |
| valid Codex managed provider | provider-owned models only | 拼入 uncallable official generated rows |
| provider model 与 public model 同 runtime id | provider row 保留一次 | public row 覆盖 provider label/origin |
| missing/invalid provider | contextual `Err(String)` | 回退默认 provider |
| provider A 请求晚于 provider B 返回 | UI 保持 provider B catalog | A 覆盖 B |
| daemon mode | 与 Desktop 相同 payload/result contract | 丢失 `providerProfileId` |
| Shared root menu open | 只读取 Profile catalog | 预取所有 Provider models |
| Shared local profile expand | forced binding-scoped config refresh；并发请求合并 | 展示或提交 completed stale cache |
| Home Atomic managed Profile active | 当前 binding scoped rows + public fallback | 注入 Native `currentModels` / Local settings override |
| backend 返回 Claude Local sentinel | Profile 保持 `source = disk`；选择后形成 `null + disk` Target | 重分类为 `managed`，导致模型点击被 resolved gate 丢弃 |
| Atomic 双栏 hover/focus | 不改变 active CLI/Profile | 鼠标经过即切换右栏 |
| Atomic 双栏 primary click | CLI 切换、Profile 折叠、Model 选择各提交一次 | `pointerdown` 抢先关闭菜单或重复提交 |
| Home creation target 跨 CLI 切换 | footer 与 hero Engine icon 同步；只投影 Engine | footer 已切换但 hero 仍读取 global Engine，或把完整 target 上提到 AppShell |
| local profile selected | catalog 用 sentinel；Target 用 `null` | 形成第二个 local Binding |
| target catalog partial failure | 仅失败 binding 显示 error | 整个模型菜单不可用 |
| catalog `id=settings-reasoning`, `model=deepseek-v4-pro` | Picker 保留 id，runtime 只收到 `deepseek-v4-pro` | 把 `settings-reasoning` 传给 CLI |
| Reload Config | 强制重读当前 binding 配置并更新模型框 | 调用 CLI discovery/HTTP |
| Codex Discover Models | 当前 Provider session 执行 `model/list` 并更新模型框 | 使用 global/default session |
| runtime 无 CLI discovery protocol | 不显示 Discover Models | 解析 `--help` 或请求 HTTP |
| refresh/discovery rejected | 保留 last-good catalog 与 selection，显示 scoped error | 清空模型框或静默成功 |
| Shared local Kimi/Grok/OpenCode target | create、persistence、V2 turn 使用对应 local catalog 严格校验 | Picker 可选但 Rust 返回 catalog unavailable |
| Shared projection managed provider lookup 返回 `Ok(None)` | `providerAvailable=false` | 仅用 `.is_ok()` 判定为可用 |

### 5. Good/Base/Bad Cases

- Good：thread 绑定 `provider-a`，service 发送 `providerProfileId: "provider-a"`，backend 解析 provider A；Codex 保持 provider-only，其他允许合并的 engine 再追加 public catalog；Composer 过滤 provider B custom rows。
- Base：legacy thread 无 provider binding，继续使用既有 engine-global catalog。
- Bad：只在创建会话时保存 provider binding，但模型刷新仍调用 `getEngineModels(engineType)`。
- Bad：provider lookup 失败后使用 `engineStatuses.models`，或给 Codex relay 拼 official fallback，导致菜单泄漏 uncallable 模型。
- Bad：只扩展 Shared Engine allowlist 与前端 Picker，遗漏 local validation catalog 或
  Projection Engine mapping。

### 6. Tests Required

- `src/services/tauri.test.ts`：断言 camelCase payload 映射、trim 与 blank omission。
- `src/features/engine/hooks/useEngineController.test.tsx`：断言 scope key、origin metadata、provider A/B stale response guard。
- `src/app-shell-parts/useProviderModelCatalogSync.test.tsx`：断言 Claude/Codex/Kimi/Grok/OpenCode thread binding 触发 scoped refresh。
- `src/app-shell-parts/useAppShellComposerModelSection.test.tsx`：断言绑定 Codex provider 后不消费 global model list。
- `src/features/composer/components/ChatInputBox/modelOptions.test.ts`：断言 provider models + public models、过滤其他 provider、runtime id 去重。
- Rust `engine::status::tests`：分别覆盖五 CLI local validation catalog；Claude/Kimi/Grok provider 优先 + public 追加/去重；Codex managed provider-only + empty/subset catalog；OpenCode 保持其 managed-only contract。
- Rust `shared_sessions::tests` + `shared_session_v2::execution_target_contract_tests`：
  覆盖 Kimi/Grok/OpenCode canonical local target 在 create/persistence 与 V2 turn
  boundary 均通过同一 strict catalog pair validation。
- Rust `shared_projection::commands::tests`：覆盖五 CLI Engine mapping，并断言 missing
  managed provider 的 `Ok(None)` 不得投影为 available。
- `ModelSelect.test.tsx` + Native continuation Rust tests：覆盖 `id != model`、backend
  UI-only id fail closed 与 custom runtime passthrough。
- `useProviderTargetCatalogOwners.test.tsx`：覆盖 Native/Atomic owner input isolation、
  config reload、Codex CLI discovery、custom/configured/discovered runtime identity merge、
  Shared local stale cache bypass、concurrent refresh coalescing、失败保留 last-good、
  Home managed Profile 保留 public fallback 但不吸收 Local settings rows，以及 Local
  sentinel scoped load与 backend-returned Local sentinel 的 `disk` identity 保真。
- `Composer.file-reference-token.test.tsx` +
  `useLayoutNodes.client-ui-visibility.test.tsx`：覆盖 Home creation target Engine 从
  Composer 投影到 Home hero owner，且不改变 Native/Shared target owner。
- `src-tauri/src/backend/app_server_tests.rs`：覆盖 managed Provider session 的
  `model/list` 路由，不回退 disk/global session。
- 必跑：`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`、`cargo test --manifest-path src-tauri/Cargo.toml engine::status::tests --lib`、`cargo check --manifest-path src-tauri/Cargo.toml --bins`。

### 7. Wrong vs Correct

#### Wrong

```typescript
await getEngineModels(activeEngine);
```

#### Correct

```typescript
await getEngineModels(activeEngine, {
  providerProfileId: activeThread.providerProfileId,
});
```

## Scenario: Product-managed catalog MUST project API protocol before Engine

### 1. Scope / Trigger

- Trigger：修改 `account_product_v1_models`、`ProductModelWire`、
  `ProductModelViewV1`、Product engine/model Picker 或 managed Product target repair。
- 目标：把上游模型 entitlement 的 API wire compatibility 与本地 CLI Engine identity
  分离；禁止按 model/vendor 名在 Renderer 拼出不同 Engine catalog。

### 2. Signatures

```rust
pub(crate) struct ProductModelWire {
    pub(crate) id: String,
    pub(crate) display_name: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) compatible_engines: Option<Vec<String>>, // legacy input only
    pub(crate) api_protocols: Option<Vec<String>>,
    pub(crate) capabilities: Option<Vec<String>>,
}
```

```typescript
type ProductModelApiProtocolV1 =
  | "openai-responses"
  | "openai-chat-completions"
  | "anthropic-messages";

type ProductModelViewV1 = {
  id: string;
  displayName: string;
  model: string;
  apiProtocols: readonly ProductModelApiProtocolV1[];
  capabilities: readonly string[];
};
```

### 3. Contracts

- `ProductModelApiProtocolV1` 描述 managed Provider HTTP/API protocol；它 MUST NOT 复用或
  推断 `engineIds.json.protocolFamily`，后者描述 CLI process/stdout transport。
- Native 是唯一 untrusted upstream normalization owner。Canonical output field MUST 为
  `api_protocols`；Renderer DTO MUST 为 `apiProtocols`，不得继续携带一份可漂移的
  `compatibleEngines` truth。
- normalization precedence MUST 为：explicit `api_protocols|supported_protocols|protocols`
  > legacy `compatible_engines|engines` 转 protocol > known family fallback > unknown fail closed。
- explicit protocol metadata 存在时是 authority；归一后为空 MUST 丢弃 row，禁止按 model
  name 重新扩权。
- legacy `codex` evidence MUST 映射为 `openai-responses`，legacy `kimi` MUST 映射为
  `openai-chat-completions`，legacy `claude|claude-code` MUST 映射为
  `anthropic-messages`。
- Product engine protocol capability MUST 使用一个 shared pure mapping：Codex 支持
  Responses、Kimi 支持 Chat Completions、Claude 支持 Anthropic Messages。禁止把
  Responses 与 Chat Completions 折叠为 broad `openai`。
- 缺 metadata 时，fallback MUST 基于 exact endpoint evidence：GPT/OpenAI 与
  Kimi/Moonshot/K3 可归 Responses + Chat Completions；Claude/Anthropic 在 production
  `claude-*` Responses→Anthropic route 与真实 Codex terminal 证明后归 Responses +
  Anthropic Messages；已有三 endpoint evidence 的 Doubao/Ark 可归全部三种；unknown
  family fail closed。
- `/v1/models` 只证明 entitlement ceiling，不证明每个 endpoint callable。只要 row 没有
  explicit protocol metadata，release/debug 结论必须来自 exact endpoint probe 或真实 CLI
  typed terminal；一个 endpoint 200 不得扩权另一个 endpoint。
- `id` / runtime `model` separation、upstream order、conversation-only filtering 与
  last-known-good refresh contract 保持不变。

### 4. Validation & Error Matrix

| 输入 | Canonical output | Product engines | 禁止行为 |
|---|---|---|---|
| `api_protocols=[responses]` | `openai-responses` | Codex | 扩到 Kimi |
| `api_protocols=[chat_completions]` | `openai-chat-completions` | Kimi | 扩到 Codex |
| legacy `compatible_engines=[kimi]` | Chat Completions | Kimi | 保留 broad OpenAI row |
| `supported_protocols=[anthropic-messages]` | `anthropic-messages` | Claude | 按 `claude-*` 名称决定 |
| explicit all three | 三者，稳定去重 | 三引擎 | 复制 model row |
| metadata absent + K3 family | Responses + Chat Completions | Codex + Kimi | 忽略 production route/probe evidence |
| metadata absent + Claude family | Responses + Anthropic Messages | Codex + Claude | 未经 route/CLI evidence 扩到 Kimi 或其他 endpoint |
| explicit unknown protocol | row rejected | none | family fallback 扩权 |
| metadata absent + unknown family | row rejected | none | Renderer presentation guess |

### 5. Good / Base / Bad Cases

- Good：Native 发布 endpoint-level `api_protocols`，统一 helper 同时供 Picker、default target
  与 engine-switch repair 使用；K3 在双 endpoint probe 通过后进入 Codex + Kimi。
- Base：旧服务端只发 `compatible_engines=[kimi]`，Native 将其升级为 Chat Completions，
  无需 Renderer compatibility branch。
- Bad：Picker 为 Codex 额外 concat Kimi models，但 target repair 仍按旧
  `compatibleEngines` fail closed。
- Bad：因为 Codex/Kimi 都被口头称为 OpenAI-compatible，就折叠 endpoint facts；route
  capability 变化后既无法安全扩权，也无法精确收窄。
- Bad：把 CLI `stream-json-cli` / `app-server-json-rpc` 当作模型 API compatibility。

### 6. Tests Required

- Rust `account::runtime::runtime_product_tests` MUST 覆盖 explicit aliases、legacy engine
  evidence、known family fallback、unknown explicit protocol fail closed、order/dedupe。
- `productOnboardingClient.test.ts` MUST 覆盖 `api_protocols -> apiProtocols` boundary 和
  unknown protocol `protocolMismatch`。
- `productModelCompatibility.test.ts` MUST 断言 GPT 与 K3/Kimi row 可进入 Codex/Kimi，
  verified Claude row进入Codex/Claude但不进入Kimi，三 endpoint row同时出现。
- `ProductEngineModelSelect.test.tsx` MUST 断言 Codex 下 Kimi-family row 可见并提交
  `engine=codex` + exact model + managed Provider identity；Kimi 下仍可提交同一 row。
- Runtime evidence MUST 至少覆盖一组相同 model 的两个 endpoint；2026-08-27 production
  route 修复后 `k3` / `k3-256k` / `kimi-for-coding` Responses 全部 200，K3 Chat Completions
  亦200；2026-08-30 `claude-opus-4-8` 经Responses→Anthropic route完成真实Codex CLI turn。
- L3 必跑 focused Vitest、Rust module tests、`npm run typecheck`、target ESLint、
  `cargo check --lib`、catalog/runtime contract checks 与 OpenSpec strict validation。

### 7. Wrong vs Correct

#### Wrong

```typescript
const codexModels = [...gptModels, ...doubaoModels];
const kimiModels = [...kimiModelsOnly, ...doubaoModels];
```

#### Correct

```typescript
const PRODUCT_ENGINE_API_PROTOCOLS = {
  codex: ["openai-responses"],
  kimi: ["openai-chat-completions"],
  claude: ["anthropic-messages"],
} as const;

const engineModels = models.filter((model) =>
  model.apiProtocols.some((protocol) =>
    PRODUCT_ENGINE_API_PROTOCOLS[engine].includes(protocol),
  ),
);
```
