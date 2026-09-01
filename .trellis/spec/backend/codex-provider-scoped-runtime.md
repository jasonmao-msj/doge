# Codex Provider-Scoped Runtime Contract

## Scenario: Codex provider-scoped runtime and thread binding

### 1. Scope / Trigger

- Trigger: 修改 `src-tauri/src/codex/**`、`src-tauri/src/shared/codex_core.rs`、`src-tauri/src/backend/app_server.rs` 的 Codex app-server launch / thread routing / fork / send path，或修改 `src-tauri/src/session_management*` 的 Codex provider binding metadata。
- 目标：Codex provider selection 是 conversation launch decision，不是全局 active provider；thread-bound operation 必须回到 persisted provider runtime。
- 当前代码事实：disk profile 保留 legacy workspace runtime key；managed profile 使用 `codex::<workspaceId>::<providerProfileId>` runtime key 与 provider-scoped `CODEX_HOME`。

### 2. Signatures

- `CODEX_DISK_PROVIDER_PROFILE_ID: "__disk__"`
- `CODEX_DISK_PROVIDER_PROFILE_NAME: "codex-tui/default-config"`
- `CodexProviderProfile::{Disk, Managed { id, name, config_toml, auth_json }}`
- `CodexProviderBinding { providerProfileId, providerProfileSource, providerProfileName, providerAvailability }`
- `resolve_codex_provider_profile(provider_profile_id: Option<&str>) -> Result<CodexProviderProfile, String>`
- `materialize_codex_provider_profile(profile: CodexProviderProfile) -> Result<MaterializedCodexProviderProfile, String>`
- `apply_codex_provider_env(command: &mut tokio::process::Command, codex_home: Option<&Path>, launch_env: &BTreeMap<String, String>) -> Result<(), String>`
- `codex_runtime_key(workspace_id: &str, provider_profile_id: &str) -> String`
- `legacy_codex_runtime_key(workspace_id: &str) -> String`
- `ensure_codex_session_for_provider(workspace_id, provider_profile_id, state, app) -> Result<(), String>`
- Tauri commands: `start_thread(workspaceId, autoSession?, providerProfileId?)`, `fork_thread(workspaceId, threadId, messageId?, providerProfileId?, targetUserTurnIndex?, targetUserMessageText?, targetUserMessageOccurrence?, localUserMessageCount?)`, `send_user_message(...)`, `resume_thread(...)`, `thread_compact(...)`, `turn_interrupt(...)`, `start_review(...)`。
- Metadata storage: `session-management/workspaces/<workspaceId>.json.codexProviderBindingBySessionId`。

### 3. Contracts

- Missing or blank provider profile id normalizes to `__disk__` only at explicit launch/default boundaries and historical metadata migration boundaries.
- Disk profile MUST use `legacy_codex_runtime_key(workspace_id)` so existing `.codex` / `CODEX_HOME` behavior remains compatible.
- Managed profile MUST be resolved from app config `codex.providers[providerProfileId]`; missing provider or empty `configToml` returns an error and MUST NOT fall back to disk.
- Managed provider home MUST be app-local under `codex-provider-homes/<providerId>/`; provider id path segment rejects empty, `.`, `..`, `/`, and `\`.
- Managed materialization MUST write `config.toml`; if `authJson` exists, it MUST JSON-validate and write `auth.json`. On Unix, written files MUST use owner-only `0600` permissions.
- Managed materialization MUST extract top-level `model`, `model_provider`, `approval_policy`, and `sandbox_mode` from `configToml` into `codex_args_override` as `-c key=value` pairs so project `.codex/config.toml` cannot silently override launch-critical settings.
- Codex child spawn MUST scan only validated `model_providers.*.env_key` names from the effective `config.toml`. Keys already provided by authoritative `launch_env` or the current process MUST win; remaining keys MAY be resolved by one bounded 5s zsh/bash login-shell invocation. Invalid shell identifiers MUST NOT be interpolated; values MUST NOT enter logs/renderer/persisted business config.
- Required `env_key` values unresolved after the bounded resolver MUST fail the exact provider launch with variable names only. They MUST NOT fall back to `__disk__` or another Provider. Resolver timeout MUST terminate/reap its process owner; desktop startup outside an actual Codex launch remains unaffected.
- `start_thread` MUST normalize selected provider id, ensure that provider runtime, call `thread/start`, and record `CodexProviderBinding` only after a thread id is returned.
- `start_thread` and model-omitted `send_user_message` MUST resolve fallback model from the same provider identity: disk keeps workspace/default lookup; managed provider reads its own top-level `configToml.model`; missing managed model means omit model, never inject disk/global fallback.
- Provider display name is opaque metadata. A Codex provider named `Kimi` MUST remain Codex and MUST NOT route to Kimi CLI.
- Create-session pipe disconnect (`Broken pipe` and platform-equivalent closed-pipe errors) MUST trigger one same-provider runtime reacquire/retry. Persistent disconnect MUST return `[SESSION_CREATE_RUNTIME_RECOVERING]` without raw OS error text.
- Thread-bound commands MUST call `resolve_thread_provider_profile_id` from metadata before ensuring/sending to a runtime. Missing metadata MAY default to disk for legacy threads; unavailable managed provider MUST surface a provider error from provider resolution.
- `resolve_thread_provider_profile_id` MUST prefer the catalog canonical key `codex:<workspaceId>:<threadId>` before compatibility keys such as `codex::<workspaceId>::<threadId>`, bare `threadId`, or `codex:<threadId>`. Blank `threadId` MUST NOT produce lookup keys. This prevents a stale legacy disk binding from overriding a canonical managed-provider binding.
- Provider-selected fork defaults to parent provider when `providerProfileId` is blank. Cross-provider fork MUST validate/ensure selected provider first, then native-fork in the parent provider runtime, copy the native child history into the selected provider home when homes differ, then record child binding.
- Stale `turn/start` recovery stays inside the same `WorkspaceSession`: classify `thread not found` / `thread_not_found`, clear foreground work, send bounded `thread/resume`, then use short bounded readiness backoff before retrying the original `turn/start`; if the retry still reports missing thread, it may retry once more and MUST clear foreground work if recovery fails.
- Daemon adapter currently supports only disk Codex runtime. It MUST parse `providerProfileId`; `None`, blank, and `__disk__` are allowed; managed provider ids return an explicit unsupported provider-scoped runtime error.
- Codex app-server launch MUST set `initialize.clientInfo.name/title` to `codex-tui`, resolve `clientInfo.version` from `codex --version`, fallback to `0.137.0`, and set terminal env hints `TERM_PROGRAM` / `TERM_PROGRAM_VERSION` while preserving existing env values when present.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| 新建会话无 `providerProfileId` | 创建 disk profile thread 并记录 disk binding | 猜测最近使用的 managed provider |
| 新建 managed provider 会话 | materialize provider home，启动 provider-scoped runtime，记录 managed binding | 写入全局 `~/.codex` 或复用 disk runtime |
| provider 缺失/删除后继续发送 | 返回 provider not found / unavailable 类错误 | 静默按 `__disk__` 发送 |
| thread metadata 缺失的旧会话 | 作为 legacy disk thread 处理 | 标记为 managed provider |
| canonical 和 legacy binding 同时存在 | 优先使用 canonical workspace key | 因 legacy 裸 id / `codex:<threadId>` 把 managed thread 路由回 disk |
| cross-provider fork | parent runtime native fork -> copy child history -> record selected provider binding | transcript seed turn 或隐藏/改写 parent thread |
| `turn/start` stale thread | same runtime `thread/resume` + short bounded readiness retry | 重新路由到 disk、无限 retry 或立即把 cold-start race 当成用户恢复卡 |
| daemon 收到 managed provider id | 显式 unsupported error | 丢弃 `providerProfileId` 后创建 disk thread |
| Codex launch identity | `codex-tui` client info + terminal fallback env | 影响 Claude/Gemini/OpenCode launch |
| managed Product `launch_env` already contains `OPENAI_API_KEY` | use the Native authority value; no login-shell lookup | shell value overrides OS-vault/managed key |
| macOS GUI misses a declared custom provider env key | one bounded login-shell resolution, then child-only env injection | print/persist secret or block AppShell startup |
| declared env key remains unavailable | provider-scoped redacted error | silent disk/default credential fallback |

### 5. Good / Base / Bad Cases

- Good: `send_user_message` 先 `resolve_thread_provider_profile_id`，再 `ensure_codex_session_for_provider`，最后把 `Some(provider_profile_id)` 传入 `send_user_message_core`。
- Good: `fork_thread` 对 cross-provider fork 只在 parent provider runtime 调 `thread/fork`，`copy_native_fork_history_to_selected_provider` 成功后才 `record_codex_provider_binding`。
- Good: `spawn_workspace_session_once` calls `apply_codex_provider_env` with the exact effective `CODEX_HOME` and already-authoritative `launch_env` before spawning the child.
- Base: 旧历史 thread 没有 metadata，默认 `__disk__`，使用 workspace-only legacy runtime key。
- Bad: managed provider 找不到时 `unwrap_or(__disk__)`。
- Bad: daemon/web adapter 解析到 `providerProfileId` 后不使用也不报错。
- Bad: `thread not found` 后重新 `start_thread` 或新建 disk thread 替代原 thread。
- Bad: per-key unbounded shell spawns；把 API key value 写进 diagnostic；忽略 Product `launch_env` 后用 shell 同名变量覆盖。

### 6. Tests Required

- Rust tests for `codex_runtime_key`, disk legacy key behavior, provider id sanitization, managed materialization, auth JSON validation, owner-only permissions where platform supports it, and launch-critical override extraction.
- Rust tests for thread binding metadata read/write and catalog projection fields `providerProfileId/source/name/availability`.
- Rust tests for provider binding lookup key order: canonical `codex:<workspaceId>:<threadId>`, legacy double-colon, bare id, `codex:<threadId>`, trimmed inputs, blank thread id.
- Rust tests for fork response enrichment and cross-provider history copy failure diagnostics.
- Rust tests for stale thread classifier and same-runtime retry behavior; at minimum classifier tests must cover both response error shapes and unrelated errors.
- Rust tests for `codex-tui` version parsing and GUI control-plane classification for `codex-tui + experimentalApi`.
- Rust tests for provider env TOML key collection、shell-name validation、multi-key framed parsing、missing key redacted failure；`cargo check --bins` MUST cover desktop + `doge_daemon` module wiring。
- Contract validation: `npm run check:runtime-contracts`, `cargo test --manifest-path src-tauri/Cargo.toml --no-run`, and `openspec validate add-codex-provider-scoped-session-launch --strict --no-interactive` after cross-layer routing changes.

### 7. Wrong vs Correct

#### Wrong

```rust
let provider_profile_id = requested_provider.unwrap_or("__disk__".to_string());
let session_key = workspace_id.clone();
// managed provider errors now silently use disk runtime
```

#### Correct

```rust
let provider_profile_id = resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
codex_core::send_user_message_core(
    &state.sessions,
    workspace_id,
    Some(provider_profile_id),
    thread_id,
    text,
    model,
    effort,
    access_mode,
    images,
    collaboration_mode,
    preferred_language,
    custom_spec_root,
    mode_enforcement_enabled,
).await
```

#### Wrong

```rust
if is_thread_not_found(error) {
    start_thread_core(&sessions, workspace_id, None, None).await?;
}
```

#### Correct

```rust
if is_thread_not_found_error_message(&error) {
    retry_turn_start_after_thread_resume(
        &session,
        &workspace_id,
        &thread_id,
        &params,
        timeout_duration,
        &error,
    ).await?;
}
```

## Scenario: Managed Codex image-capable catalog materialization

### 1. Scope / Trigger

- Trigger: 修改 `src-tauri/src/codex/managed_model_catalog.rs`、managed `ensure_codex_session_for_provider`、Codex binary selection 或 `model_catalog_json` launch override。
- 目标：custom API-key provider 使用 `gpt-5.6-sol/terra/luna` 时必须退出 ChatGPT-only Responses Lite，使 token2api hosted `image_generation` bridge 可提供真实图片工具；不得维护一份与 Codex binary 漂移的 hardcoded full catalog。

### 2. Signatures

- `materialize_managed_codex_model_catalog(codex_bin: Option<&str>, codex_home: &Path) -> Result<PathBuf, String>`
- `managed_model_catalog_codex_args(path: &Path) -> String`
- exporter command：`<exact-codex-bin> debug models --bundled`
- artifact：`<isolated CODEX_HOME>/managed-model-catalog.json`
- launch override：`-c model_catalog_json="<absolute-path>"`
- stable error prefix：`[MANAGED_CODEX_MODEL_CATALOG]`

### 3. Contracts

- 仅 `providerProfileId=doge-token-matrix` 的 managed cold launch执行；disk/local/custom provider MUST NOT 注入该 catalog。
- exporter 必须复用 exact launch binary/wrapper/PATH resolution，15s bounded timeout，stdout ≤ 4 MiB、stderr ≤ 64 KiB；timeout 必须终止并 reap process owner。
- catalog 必须是 top-level object + `models` array，且三个 exact slug 各出现一次；只写 `use_responses_lite=false`，unknown entries/fields 全部保留。
- patched catalog 以 owner-only `0600` staged file + same-directory atomic replace 发布；相同内容重复 materialize 是 no-op/equivalent。
- `model_catalog_json` override 必须追加在 workspace/provider args 之后，以 managed authority 胜出；不得修改 terminal global `~/.codex/config.toml`。
- export、parse、shape、size 或 atomic write 任一失败时，必须在 `thread/start` / Binding / Turn side effect 前 fail closed；不得 silent fallback 到 Responses Lite。
- 图片完成只认 native `image_generation_call` + non-empty payload；assistant “已生成” 文本不是成功 authority。Realtime/history 继续复用既有 generated-image projection。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| managed exact binary exports valid catalog | patch three slugs、atomic write、append absolute override | hardcode full upstream models snapshot |
| future binary already marks one slug non-Lite | preserve and produce same effective false value | reject merely because source is already false |
| target slug missing/duplicate/not object | return `[MANAGED_CODEX_MODEL_CATALOG]` before spawn | partial patch and continue |
| command non-zero/timeout/oversized/empty | bounded diagnostic + terminate/reap | hang startup or log secret-bearing env |
| disk/local/custom provider | no materializer/no override | alter user-owned provider semantics |
| image response contains base64 result | existing generated-image card completes | infer success from prose |

### 5. Good / Base / Bad Cases

- Good：Doge managed Codex cold launch derives current binary catalog、patches three booleans、token2api记录 image accounting，幕布渲染真实 preview。
- Base：同 binary/provider home重复启动，artifact content保持相同，atomic writer不留 temp file。
- Bad：把 `models.json` snapshot随App发布后永久复用；或 exporter失败时继续用 bundled Lite metadata。

### 6. Tests Required

- Pure Rust tests：三 slug exact patch、unknown preservation、already-false、missing/duplicate/malformed rejection。
- Process tests：success、non-zero、timeout、stdout oversize；assert stable redacted error prefix。
- File tests：same content idempotence、changed content replace、no staged residue、Unix mode `0600`。
- Args tests：含空格路径 round-trip 为一个 `-c model_catalog_json=...` value，且 appended after existing args。
- Integration smoke：使用当前真实 Codex binary materialize，managed request无 Responses Lite；token2api usage出现 `按次(图片)` + one image，Hot Doge native event为 `image_generation_call`。
- L3：`cargo test --manifest-path src-tauri/Cargo.toml --lib managed_model_catalog`、`cargo check --manifest-path src-tauri/Cargo.toml --lib`、`npm run check:runtime-contracts`、strict OpenSpec validation。

### 7. Wrong vs Correct

#### Wrong

```rust
// Stale full catalog copied from one Codex release.
let path = app_resources.join("models-0.151.json");
spawn_codex_with_catalog(path).await?;
```

#### Correct

```rust
let catalog = materialize_managed_codex_model_catalog(
    selected_codex_bin.as_deref(),
    isolated_provider_home,
).await?;
let args = managed_model_catalog_codex_args(&catalog);
// Append after workspace/provider overrides, before app-server spawn.
```

## Scenario: Shared managed Codex generated-image durability and live convergence

### 1. Scope / Trigger

- Trigger：修改 `src-tauri/src/shared_generated_image_artifact.rs`、`shared_session_v2::commit_observed_runtime_settlement`、`shared_projection::SharedProjector`、`workspaces::read_local_image_data_url` 或 Shared V2 committed UI boundary。
- 目标：Codex app-server realtime surface 未转发 provider-private `response_item/image_generation_call` 时，Shared 仍从 exact managed rollout 建立真实 image artifact；当前页面、reload 与 app restart 使用同一 canonical projection。
- Upgrade contract：existing product user 安装新 binary 后，下一个 managed Shared Codex Turn 自动走该链路；不要求清配置、重新登录或重建 Shared Session。旧版本已提交且 `artifactRefs=[]` 的历史 Turn 不伪造 backfill。

### 2. Signatures

- `resolve_managed_codex_native_history_path(provider_profile_id: &str, thread_id: &str) -> Result<PathBuf, String>`
- `resolve_managed_codex_provider_home(provider_profile_id: &str) -> Result<PathBuf, String>`（read-only path resolution；不得 materialize/rewrite config）
- `materialize_codex_generated_images_from_history(app_data_dir: &Path, history_path: &Path, runtime_turn_id: &str) -> Result<Vec<ArtifactRef>, String>`
- `reconcile_managed_codex_generated_images(state: &AppState, settled: &mut SettledSharedRuntimeAttempt)`
- `ArtifactRef { artifactId, mediaType, sizeBytes, sha256, locator, sourceToolName, promptText }`
- shared payload bound：`workspaces::MAX_INLINE_IMAGE_BYTES = 20 MiB`（materializer 与 preview reader 共用）
- storage：`<Tauri App Data>/generated-images/shared/<sha256>.<ext>`
- local preview allowlist：`append_app_owned_image_preview_roots(..., <App Data>/generated-images/shared)`
- UI terminal convergence：`useThreadMessaging -> refreshThread(workspaceId, sharedThreadId)` after `v2.committed=true`。

### 3. Contracts

- Success authority MUST be exact provider-scoped rollout `response_item` with type `image_generation_call|image_generation_end`、completed status、non-empty result and `internal_chat_message_metadata_passthrough.turn_id == owner.runtime_turn_id`。assistant prose/link MUST NOT count as image evidence。
- Reconcile MUST use frozen managed `providerProfileId` + exact `nativeSessionId` + exact `runtimeTurnId`；same-session older Turn image MUST NOT attach to current Turn。
- Terminal history lookup MUST resolve the managed provider home without rewriting `config.toml`/`auth.json`；configuration materialization remains owned by exact engine prepare。
- History reconcile MUST read only the latest 64 MiB tail and use a 32 MiB hard-capped line reader；oversized lines are discarded with `fill_buf/consume` without first allocating the whole line。Base64 decode MUST be bounded to 20 MiB decoded bytes；only PNG/JPEG/GIF/WebP magic is accepted。bytes MUST publish by SHA-256 content-addressed temp + fsync + rename；same content is idempotent。
- Shared SQLite/checkpoint/React durable state MUST store only compact `ArtifactRef` and stable local locator，never multi-megabyte Base64。
- `turnCommitted.artifactRefs -> SharedProjector::GeneratedImage -> toSharedConversationItems -> GeneratedImageRow` is the only restored render path。Projection image id MUST reuse `artifactId` to merge with any live item rather than duplicate。
- Shared V2 committed boundary MUST install exact terminal barrier first，then best-effort `refreshThread` canonical projection，then clear processing。Refresh failure writes diagnostic but MUST NOT roll back durable success。
- `read_local_image_data_url` MAY read the canonical `<App Data>/generated-images/shared` root；its parent/sibling/arbitrary absolute paths remain denied。Remote mode behavior remains unchanged。

### 4. Validation & Error Matrix

| State | Required result | Forbidden result |
|---|---|---|
| exact Turn has valid completed PNG | atomic file + compact artifact + visible card | infer from “已生成” text |
| same native session only has older image | no current artifact | attach stale image |
| malformed/oversized/unsupported result | warning + no image artifact；durable terminal remains authoritative | Base64 in SQLite or unbounded allocation |
| content repeats | reuse same SHA path | duplicate bytes/temp residue |
| Shared canvas already open | committed boundary refreshes canonical projection | require manual reopen |
| projection refresh fails | keep committed result + diagnostic | report send failure/retry Runtime |
| locator under exact managed root | local data URL preview | allow whole App Data or arbitrary filesystem |

### 5. Good / Base / Bad Cases

- Good：existing v0.1.13 user upgrades，keeps login/config/session，next Shared Sol image Turn writes one App Data PNG、one canonical artifact，current canvas immediately renders and restart still renders。
- Base：normal text Turn scans exact history but finds no matching image，returns empty artifact list without changing terminal semantics。
- Bad：wait for a nonexistent `codex/raw image_generation_call` realtime event；或 scan latest image without matching runtime turn id。
- Bad：store raw Base64 in `turnCommitted`；或 add App Data root itself to preview allowlist。

### 6. Tests Required

- Rust materializer：exact-turn match、older-turn rejection、bounded tail/line discard、invalid/oversized result、format magic、idempotent content-addressed write、no Base64 in `ArtifactRef`。
- Rust lifecycle：artifact survives accumulator/terminal snapshot；Shared projection emits `GeneratedImage` with stable artifact id/path/prompt。
- Rust preview policy：allow exact `generated-images/shared`，assert parent App Data and `generated-images` parent are not added。
- Vitest：Shared V2 committed response calls `refreshThread` before processing cleanup；refresh rejection preserves `v2.committed=true` and emits diagnostic。
- Hot Doge：assert rollout model=`gpt-5.6-sol`、completed native image result、physical file、non-empty `turnCommitted.artifactRefs`、current UI image visible、reopen visible。

### 7. Wrong vs Correct

#### Wrong

```rust
// App server does not promise this provider-private response item.
if method == "codex/raw" && payload_type == "image_generation_call" {
    canonical.artifact_refs.push(data_url_artifact(payload.result));
}
```

#### Correct

```rust
let history = resolve_managed_codex_native_history_path(provider_id, native_session_id)?;
let artifacts = materialize_codex_generated_images_from_history(
    app_data_dir,
    &history,
    runtime_turn_id,
)?;
settled.final_snapshot.artifacts.extend(artifacts);
```

## Scenario: Product-managed Codex first-turn target MUST be atomic

### 1. Scope / Trigger

- Trigger：修改 `src-tauri/src/account/configuration.rs` 的 managed Codex recipe/revision，或修改 `Composer`、`MessageSendOptions`、`useThreadMessaging` 的 Product Native first-send model routing。
- 目标：UI target、readiness、durable target 与 Codex `turn_context.model` 必须同源；新会话立即发送不得回落被 Product channel 禁止的 config/global model。

### 2. Signatures

- `ACCOUNT_MANAGED_CODEX_MODEL: &str = "gpt-5.6-sol"`
- `ACCOUNT_MANAGED_CONFIGURATION_REVISION: i64 = 3`
- `MessageExecutionTargetSnapshot { engine, providerProfileId, modelCatalogEntryId, model, reasoning, providerProfileNameSnapshot, providerProfileSource }`
- `MessageSendOptions.nativeExecutionTarget?: MessageExecutionTargetSnapshot`
- `resolveProductManagedExecutionTargetV1(...) -> ExecutionTarget | null`

### 3. Contracts

- Managed Codex isolated config MUST set both `model` and `review_model` to `ACCOUNT_MANAGED_CODEX_MODEL`；exact-engine prepare MUST replace revision-2 projection before ready。Kimi's independent default MUST remain unchanged。
- Product-ready Existing Native session MUST derive `selectedAtomicTarget` from canonical `nativeProductTarget` before falling back to presentation-only native state。
- If managed Native target is unresolved, Composer input remains editable but submit MUST be disabled；no Session/Binding/Turn fallback side effect is allowed。
- Resolved managed Native send MUST carry one complete `nativeExecutionTarget` object。`useThreadMessaging` MUST consume runtime model、catalog id and effort from the same snapshot before per-thread/cache/default values。
- Snapshot Engine mismatch or known Provider binding mismatch MUST fail closed before optimistic UI and Runtime send。
- Local/disk/custom provider paths MUST preserve existing behavior and MUST NOT inherit Product Sol fallback semantics。

### 4. Validation & Error Matrix

| State | Required result | Forbidden result |
|---|---|---|
| revision-2 Doge Codex config | revision 3 + Sol model/review model | keep `gpt-5.5` |
| Product Native target resolved | exact frozen send | read stale composer cache |
| Product Native target unresolved | submit disabled | config/global fallback send |
| target model Terra/Luna | exact selected runtime | replace with Sol fallback |
| target Engine/Provider mismatch | zero native send + localized failure | send target into another binding |
| Kimi/local/custom | unchanged | Codex migration rewrites their runtime model |

### 5. Good/Base/Bad Cases

- Good：UI 显示 `gpt-5.6-sol`，`nativeExecutionTarget.model`、`send_user_message.model` 与 rollout `turn_context.model` 全部为 Sol。
- Base：无 explicit target 的 internal managed fallback 使用 Sol，但 normal Product send仍以 frozen target为authority。
- Bad：把 `model` 与 `modelCatalogEntryId` 作为独立 optional fields，让类型可表达 Sol/5.5 split truth。
- Bad：为消除 503 仅在 token2api pricing 中放开 `gpt-5.5`；这会掩盖客户端 target drift。

### 6. Tests Required

- Rust configuration tests MUST cover revision-2 migration、exact Sol recipe、Kimi default isolation、local/custom preservation and idempotent current prepare。
- Composer test MUST cover immediate first send and unresolved managed target zero-send。
- Messaging test MUST cover stale cache cannot overwrite snapshot catalog/runtime identity and Provider mismatch zero-send。
- L3 gates：focused Vitest、target ESLint、`npm run typecheck`、`npm run check:runtime-contracts`、`cargo test ... account:: --lib`、`cargo check --lib`、strict OpenSpec validation。
- Hot Doge smoke MUST compare exact UI model、rollout `turn_context.model` and native completed `image_generation_call`。

### 7. Wrong vs Correct

#### Wrong

```ts
send({
  model: resolvedComposerSelection?.model ?? managedConfigDefault,
  modelCatalogEntryId: cachedSelection?.modelId,
});
```

#### Correct

```ts
const target = resolveProductManagedExecutionTargetV1(productSnapshot);
if (!isResolvedExecutionTarget(target)) return keepSubmitDisabled();
send({ nativeExecutionTarget: freezeExecutionTarget(target) });
```

## Scenario: Codex curated-skill deactivation across resumed threads

### 1. Scope / Trigger

- Trigger: 修改 `AppSettings.enabled_curated_skill_ids`、`set_curated_skill_enabled`、`codex_curated_skills_developer_instructions_block()`、Codex app-server spawn arguments、全平台 `turn/start` collaboration-mode instructions 或 settings-triggered runtime restart。
- 目标：启停 ccgui bundled curated skill 后，即使继续 resume 同一 Codex `threadId`，next turn 也必须收到最新 enabled snapshot；旧轮次中未列出的 bundled skill instructions 必须被明确撤销。

### 2. Signatures

- `codex_curated_skills_developer_instructions_block(app_settings: &AppSettings) -> Option<String>`
- `codex_generated_developer_instructions_for_turn(app_settings: &AppSettings) -> Option<String>`
- `build_codex_app_server_args_with_settings(codex_args, options, app_settings) -> Result<Vec<String>, String>`
- `restart_all_connected_sessions_core(...) -> Result<(), String>`
- Codex resume payload: `thread/resume { threadId }`
- Authoritative marker: `## Curated Skills` + `Enabled: <ids|none>.`

### 3. Contracts

- app-server restart MUST NOT be treated as clearing Codex thread history；runtime replacement 后仍可能 resume 原 `threadId`。
- 每个 generated curated block MUST 是 ccgui bundled curated skills 的 authoritative snapshot。只有当前 section 中列出的 `<skill>` blocks 生效；旧轮次中未列出的 bundled skill MUST 被声明 inactive。
- Empty enabled set MUST emit `Enabled: none.` and MUST NOT omit the curated section。
- Partial enabled set MUST list only current ids and bodies；关闭一个 skill 时不得继续携带其旧 body。
- macOS / Linux MUST 保留既有 spawn-time instructions；macOS / Linux / Windows 的 turn-start instructions MUST 复用同一 snapshot builder，并在 desktop、shared session、daemon send path 读取最新 settings。
- Snapshot authority MUST be scoped to ccgui bundled curated skills。它 MUST NOT 撤销 user-supplied `developer_instructions`、system instructions 或其他机制提供的 skill。
- 用户通过 `codex_args` 显式提供 instruction override 时，existing override precedence MUST 保持不变；generated curated transport 不得重复注入或覆盖该 override。
- `WorkspaceSession.generated_developer_instructions_enabled` MUST 在 launch 时由 effective `codex_args` 计算；`false` 时 turn-level merge MUST omit ccgui-generated curated snapshot，同时保留 request 自带的 developer instructions 与 collaboration policy。

### 4. Validation & Error Matrix

| State / path | Required behavior | Forbidden behavior |
|---|---|---|
| two enabled | 列出两个 ids 与两个 `<skill>` bodies | 丢失其中一个 body |
| one disabled, one enabled | snapshot 只列仍启用 id；声明未列出的旧 bundled skill inactive | 继续携带 disabled body |
| all disabled | `Enabled: none.`；无 `<skill>` body | 返回 `None` / 省略整个 curated state |
| macOS / Linux settings restart | 新 app-server 保留 launch snapshot；next turn 再带最新 authoritative snapshot | 假设 process restart 已更新 resumed thread 的 developer state |
| Windows next turn | `collaborationMode.settings.developer_instructions` 带同一 snapshot，process argv 仍 omit body | Windows 使用不同文案或恢复大型 argv 注入 |
| explicit user instruction override | 保留 user override precedence | generated block 覆盖 user text |

### 5. Good / Base / Bad Cases

- Good：关闭 Caveman、保留 Ponytail 后，snapshot 为 `Enabled: \`lazy-senior-dev\`.`，只含 Ponytail body，并声明未列出的旧 bundled skill inactive。
- Base：fresh thread 使用当前 enabled snapshot，没有旧状态需要撤销。
- Bad：empty list 让 builder 返回 `None`；runtime 虽重启，但 resumed thread 继续遵循旧 Caveman block。
- Bad：为停用 skill 强制创建新 native thread，造成 thread identity 与可见历史无必要漂移。

### 6. Tests Required

- Rust unit test MUST assert empty settings emit `Enabled: none.` and no `<skill id=` body。
- Rust unit test MUST assert partial settings list only enabled ids/bodies and include inactive-unlisted wording。
- Spawn-transport test MUST assert macOS / Linux style argv contains the empty deactivation snapshot。
- Turn-transport test MUST assert cross-platform generated instructions contain enabled / empty snapshots；desktop、shared session、daemon 调用点 MUST 不再被 `cfg(windows)` 限制。
- Existing user override and wrapper-recovery tests MUST remain green。
- Run `cargo test --manifest-path src-tauri/Cargo.toml --lib curated_skill_injection_tests` and `npm run check:runtime-contracts`。

### 7. Wrong vs Correct

#### Wrong

```rust
if enabled.is_empty() {
    return None; // runtime restart does not erase resumed thread history
}
```

#### Correct

```rust
let enabled_label = if enabled.is_empty() { "none" } else { "<current ids>" };
Some(format!(
    "## Curated Skills\n\nOnly blocks listed here are active. \
     Earlier unlisted bundled skills are inactive.\n\nEnabled: {enabled_label}."
))
```

## Scenario: Codex stale recovery cookbook

### 1. Scope / Trigger

- Trigger: 修改 `src/features/threads/hooks/useCodexMessageRecovery.ts`、`src/features/threads/utils/codexConversationLiveness.ts`、`src/features/threads/utils/stabilityDiagnostics.ts`、`send_user_message` stale-thread recovery、或未来为 `GEMINI` / `CLAUDE` 增加 stale session recovery hook。
- 目标：把 stale thread/session 恢复拆成可诊断、可复用、可回滚的 attempt-oriented contract；不能把空白 first-turn draft、durable stale conversation、runtime reconnect 混成同一种“重试”。
- Backlinks:
  - OpenSpec `codex-message-recovery-hook`：定义 `useCodexMessageRecovery()` 顶层 hook + `createRecoveryAttempt(deps)` 子 attempt 接口。
  - OpenSpec `codex-stale-thread-binding-recovery`：定义 empty first-turn Codex draft、same-id rebind、durable stale thread 的恢复边界。

### 2. Diagnostic Field Semantics

`staleRecoveryClassification` 是 UI/runtime recovery 的诊断 payload，不是 backend 私有 error type。字段进入 debug event、runtime notice 或用户恢复卡前必须保持稳定语义。

| Field | Accepted values | Trigger / Meaning |
|---|---|---|
| `reasonCode` | `malformed-thread-id` | 当前 thread id 无法作为 provider thread/session id 使用，例如 review/command 路径传入非法 id；只允许 disposable first-turn draft 走 fresh continuation。 |
| `reasonCode` | `missing-thread-binding` | frontend/local state 有当前用户意图，但没有可验证 provider binding 或 backend/session catalog 找不到对应 binding；可先尝试 verified rebind，first-turn empty draft 可 fresh continuation。 |
| `reasonCode` | `stale-thread-binding` | thread/session id 曾经有效，但 provider runtime 返回 `thread not found` / `session not found`；durable conversation 必须先 rebind/fork，不能 silent replacement。 |
| `staleReason` | `user-edited-prompt-after-send` | 用户在 send/recovery 窗口内继续编辑或替换 prompt，旧 optimistic intent 不能被无提示重放。 |
| `staleReason` | `concurrent-thread-recreated` | 同一 workspace/thread identity 被另一路刷新、fork、rebind 或 session catalog update 替换。 |
| `staleReason` | `app-server-restart` | app-server / provider runtime restart 后内存态 thread handle 丢失，但磁盘或 catalog 可能仍可恢复。 |
| `userAction` | `fresh-continuation` | 创建新 provider thread/session，并把当前 disposable optimistic user intent 移到新 thread 后重发；用户应看到新的 thread identity。 |
| `userAction` | `fork-and-retry` | 从旧 thread/message fork 出可继续的 thread，再迁移 optimistic intent 并重发；适用于 old id 不可继续但仍有 parent/history anchor。 |
| `userAction` | `rebind-and-retry` | 已找到 verified replacement/rebound thread id，切换 active thread 后在该 id 上重试；不得重试刚失败的 same id。 |

Existing runtime reconnect diagnostics may still use legacy values such as `broken-pipe`, `runtime-ended`, `workspace-not-connected`, `recover-thread`, or `start-fresh-thread` in `src/features/threads/utils/stabilityDiagnostics.ts`. Those values are reconnect/card compatibility fields. New provider-specific stale recovery cookbook entries SHOULD map them into the attempt-oriented values above before deciding recovery behavior.

### 3. Recovery Failure Playbook

| Failure class | Required evidence | Preferred action | Hard stop |
|---|---|---|---|
| Disposable first-turn draft missing | accepted-turn fact is `empty-draft`, no durable items, local optimistic user intent exists | `fresh-continuation` before fork fallback | Do not show a manual stale-thread card for an empty draft if fresh continuation succeeds. |
| Same-id rebind after missing thread | refresh/rebind returns the same `threadId` that just failed | Treat as unverified; continue to `fresh-continuation` or explicit failure | Do not retry the same missing id and call it recovered. |
| Durable stale conversation | accepted turn exists, assistant output exists, persisted session/history exists, or durable activity is unknown | `rebind-and-retry`; if impossible, `fork-and-retry` or visible recovery card | Do not silently create a fresh thread that hides prior durable history. |
| Provider runtime restart | provider runtime/app-server restarted while catalog still has session metadata | same-runtime readiness/rebind first, then `rebind-and-retry` | Do not route managed provider work to `__disk__` as fallback. |
| User intent changed during recovery | composer draft or optimistic user item no longer matches failed send intent | visible failure/retry prompt | Do not replay stale text into a new thread. |

Implementation rules:

- `useCodexMessageRecovery()` MUST stay a top-level React hook. Dynamic per-send dependencies belong in `createRecoveryAttempt(deps)`.
- Each recovery attempt MUST be single-shot for fresh continuation. Repeated calls in the same send attempt must return `false` without creating another thread.
- `tryFreshDraftReplacement()` MUST require both a recoverable classification and current optimistic user intent.
- `tryForkFromMessage()` MUST not run when a verified rebound thread id already differs from the failed id; that path belongs to `rebind-and-retry`.
- Debug events SHOULD include `{ stage, outcome, reasonCode, staleReason, userAction }` so a later perf/evidence producer can distinguish measured recovery from proxy inference.

### 4. GEMINI / CLAUDE Provider Recovery Template

Future `GEMINI` / `CLAUDE` recovery hooks SHOULD reuse the Codex attempt shape and replace only provider-specific classifiers and APIs:

```ts
type ProviderRecoveryAttemptDeps = {
  provider: "gemini" | "claude";
  workspaceId: string;
  threadId: string;
  reboundThreadId: string | null;
  staleRecoveryClassification: {
    reasonCode: "malformed-thread-id" | "missing-thread-binding" | "stale-thread-binding";
    staleReason?: "user-edited-prompt-after-send" | "concurrent-thread-recreated" | "app-server-restart";
    userAction: "fresh-continuation" | "fork-and-retry" | "rebind-and-retry";
  } | null;
  startProviderSession: () => Promise<string | null>;
  forkProviderSession: () => Promise<string | null>;
  retrySendOnSession: (sessionId: string) => Promise<void>;
};
```

Provider-specific substitutions:

| Provider | Classifier source | Fresh start API | Fork API | Notes |
|---|---|---|---|---|
| `GEMINI` | Gemini CLI session missing / session JSON not found / process restart evidence | `startThreadForMessageSend(workspace, "gemini")` or provider-specific session starter | `forkGeminiSession` equivalent only after history anchor exists | Do not infer measured recovery unless Gemini source artifact proves session id replacement. |
| `CLAUDE` | Claude Code JSONL missing / `claude-pending-*` draft missing / history loader cannot hydrate id | `startThreadForMessageSend(workspace, "claude")` or Claude session starter | `forkClaudeSessionFromMessage` when message anchor exists | Respect `CLAUDE_HOME` / configured Claude home from `claude-context-usage-contract.md`; do not mix histories across homes. |

Template constraints:

- The provider hook SHOULD expose `createRecoveryAttempt(deps)` rather than accepting dynamic deps in the hook call.
- The provider hook MUST keep durable-history protection: accepted or persisted history requires verified rebind/fork before fresh continuation.
- The provider hook MUST emit the same diagnostic field names so UI notices and perf evidence do not need provider-specific parsing.
- Provider-specific fallback MUST stay inside that provider's runtime/home. No recovery path may silently switch to Codex disk runtime or another provider.

### 5. Validation & Error Matrix

| Scenario | Required behavior | Forbidden behavior |
|---|---|---|
| malformed first-turn draft id | classify `malformed-thread-id`, then fresh continuation if optimistic intent exists | fork or retry the malformed id |
| missing binding for empty draft | classify `missing-thread-binding`, create fresh thread once, move optimistic intent, retry | create multiple fresh threads for one send attempt |
| durable stale thread | classify `stale-thread-binding`, attempt rebind/fork or show visible recovery | silent fresh replacement |
| app-server restart | preserve provider runtime identity while recovering | fallback managed provider to disk |
| future Gemini/Claude recovery | reuse `createRecoveryAttempt(deps)` and diagnostic fields | build a provider-specific ad hoc recovery payload |

### 6. Tests Required

- Hook tests for `useCodexMessageRecovery`: fresh continuation, fork retry, same-id rebind rejection, no optimistic item, and idempotent repeated attempt.
- Classifier tests for `staleRecoveryClassification`: `malformed-thread-id`, `missing-thread-binding`, `stale-thread-binding`, and unrelated errors.
- Provider template implementations MUST add provider-focused tests before enabling runtime behavior.
- Contract validation after behavior changes: `npm run check:runtime-contracts`, focused Vitest hook tests, and relevant OpenSpec strict validate.
