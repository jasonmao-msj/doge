# Backend Quality Guidelines

## 必须遵守（Must）

- command 行为可预测（deterministic）且具备 clear error path。
- 共享状态访问遵循 `AppState` 锁策略。
- 文件写入遵循 lock + atomic write 模式。
- 关键行为变更同步更新 frontend mapping/tests。

## 禁止项（Never）

- runtime path 使用 `unwrap/expect`。
- 新增 command 但遗漏 `command_registry.rs` 注册。
- 命令参数改名后不更新 `src/services/tauri.ts`。
- 破坏幂等性导致 retry 重放污染。

## 推荐验证命令

先按 [Risk-Based Test Strategy](../guides/risk-based-test-strategy.md) 选择 L0–L4。Backend 本地开发默认运行受影响 module/contract 的 focused commands；以下全量命令属于 L4 Release/CI，不再是所有修改的默认前置条件：

```bash
npm run check:runtime-contracts
npm run doctor:strict
npm run test
npm run typecheck
```

必要时补充 Rust 侧测试：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

L3 IPC/runtime/auth/vault/persistence/installer 变更 MUST 覆盖各受影响层的 focused tests、相关 contract checks，并按 compile surface 追加 `cargo check --lib`；除非影响面无法界定或用户明确要求，不默认执行全量 `cargo test` / `npm run test`。

## Review Checklist

- command contract 是否与 frontend 一致？
- 锁粒度是否合理？是否存在锁内重 IO？
- 错误信息是否可追踪且无敏感泄露？
- 是否有回归测试覆盖新增/修改路径？

## Scenario: Tauri native binary export persistence

### 1. Scope / Trigger

- Trigger：Desktop feature 将 Canvas/Blob/ArrayBuffer 等 binary artifact 保存到用户选择路径，例如 Mermaid PNG export。
- 目标：Tauri runtime 必须使用 native Save Dialog + narrow command；不得假设 WebView 支持 `<a download>` / `blob:` persistence。

### 2. Signatures

- Frontend exporter：`downloadMermaidPng({ svg, dataUrl, filename? }): Promise<void>`。
- Service wrapper：`saveMermaidPngFile(path: string, pngBytes: number[]): Promise<void>`。
- Native dialog：`save({ defaultPath, filters }): Promise<string | null>`。
- Tauri command：`save_mermaid_png(path: String, png_bytes: Vec<u8>) -> Result<(), String>`。
- IPC mapping：`invoke("save_mermaid_png", { path, pngBytes })`；camelCase `pngBytes` MUST map to Rust `png_bytes`。

### 3. Contracts

- Tauri runtime MUST 先生成 valid PNG Blob，再通过 native dialog 获取 explicit user-selected path。
- Dialog cancellation (`null`) MUST resolve as no-op；不得写文件或显示 failure。
- Backend MUST validate payload before any filesystem mutation。
- PNG command MUST accept only PNG signature `89 50 4E 47 0D 0A 1A 0A` and encoded payload `<= 128 MiB`。
- Write MUST reuse `with_storage_lock()` + `write_bytes_atomically()`；error MUST propagate to viewer recoverable state。
- Non-Tauri runtime MAY use anchor fallback，但 MUST remove anchor and revoke Object URL on success/failure。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| valid PNG + selected path | atomic write，返回 `Ok(())` | 依赖 WebView download |
| dialog cancel | no-op，control 恢复 idle | 显示 failure 或创建文件 |
| invalid/empty signature | `Err`，target 不创建/覆盖 | 先写后验 |
| payload > 128 MiB | `Err`，target 不创建/覆盖 | 无界 IPC persistence |
| filesystem failure | contextual `Err`，UI 可重试 | silent success |
| Web runtime | anchor fallback + cleanup | 调用不存在的 Tauri IPC |

### 5. Good / Base / Bad Cases

- Good：feature-specific `save_mermaid_png` 只允许 validated PNG，并通过 atomic storage helper 落盘。
- Base：用户取消 native dialog，Promise 正常完成且 viewer 保持打开。
- Bad：在 Tauri 中仅执行 `anchor.click()`，测试 mock click 通过但真实 WebView 不保存。
- Bad：新增通用 `write_binary_file(path, bytes)` 或授予 broad filesystem plugin permission 来满足单一 export verb。

### 6. Tests Required

- Frontend Vitest MUST 覆盖 native success/cancel/IPC rejection 与 Web fallback Object URL cleanup。
- Rust tests MUST 覆盖 valid write、invalid signature、oversized payload，并断言 rejected target 不存在。
- Cross-layer gate MUST assert command 在 `command_registry.rs` 注册，`src/services/tauri/mermaidExport.ts` 的 invoke payload 使用 `path` + `pngBytes`。
- Required commands：focused Vitest、`cargo test ... mermaid_export`、`npm run check:runtime-contracts`、`npm run typecheck`、`npm run lint`。

### 7. Wrong vs Correct

#### Wrong

```typescript
const url = URL.createObjectURL(pngBlob);
anchor.href = url;
anchor.download = "mermaid-diagram.png";
anchor.click(); // Tauri WebView 不保证触发 native save。
```

#### Correct

```typescript
const path = await save({
  defaultPath: "mermaid-diagram.png",
  filters: [{ name: "PNG", extensions: ["png"] }],
});
if (path) {
  await saveMermaidPngFile(path, pngBytes);
}
```

## Scenario: Engine control-plane isolation for Codex app-server

### 1. Scope / Trigger

- Trigger：修改 Codex binary resolution、`WorkspaceSession` spawn、Codex doctor、Claude history scanner/loader，或任何跨 engine runtime launch path。
- 目标：Codex app-server 控制面 payload 只能进入真实 Codex runtime，不能 fallback 到 Claude CLI 或污染 Claude transcript。

### 2. Signatures

- `resolve_codex_launch_context(codex_bin: Option<&str>) -> CodexLaunchContext`
- `check_codex_installation(codex_bin: Option<String>) -> Result<Option<String>, String>`
- `probe_codex_app_server(codex_bin: Option<String>, codex_args: Option<&str>) -> Result<CodexAppServerProbeStatus, String>`
- `spawn_workspace_session_with_auto_compaction_threshold(...) -> Result<Arc<WorkspaceSession>, String>`
- `list_claude_sessions_from_base_dir(...) -> Result<Vec<ClaudeSessionSummary>, String>`
- `load_claude_session_from_base_dir(...) -> Result<ClaudeSessionLoadResult, String>`

### 3. Contracts

- Codex launch resolution MUST only resolve `codex` or explicit custom Codex binary; it MUST NOT resolve or fallback to `claude`.
- Codex session spawn MUST fail before process launch unless `codex app-server --help` capability probe succeeds for the resolved binary and args.
- Windows `.cmd/.bat` compatibility retry MAY run only after the same Codex capability gate path and MUST NOT convert a Claude wrapper into a Codex runtime.
- Codex missing/custom mismatch errors MUST be Codex-specific and MUST NOT recommend installing Claude as a substitute.
- Claude history scanner/load path MUST filter high-confidence control-plane entries before counting messages, deriving first message, or returning loaded messages.
- The control-plane predicate MUST use structured signals such as JSON-RPC `initialize`, `clientInfo.name/title=ccgui` + `capabilities.experimentalApi`, `developer_instructions`, and pure Codex app-server invocation text. Pure Codex app-server text means `app-server` alone or command-token form such as `codex app-server`, `codex.exe app-server`, `codex.cmd app-server`, or `codex.bat app-server`. It MUST NOT filter normal user text merely because it mentions `app-server` or `codex app-server`.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| Codex missing, Claude installed | return Codex-specific missing/capability error | start `claude app-server` |
| custom Codex bin points to Claude | fail `app-server --help` capability gate | accept `--version` as identity proof |
| Windows Codex wrapper primary launch fails | allow wrapper retry only for Codex-capable wrapper | retry arbitrary non-Codex wrapper |
| Claude JSONL only has control-plane payload | no visible session summary | create `app-server` / `developer` pseudo session |
| Claude JSONL mixes real messages and control-plane payload | drop pollution and keep real messages | drop whole transcript or count pollution |
| User asks about app-server / codex app-server in natural language | keep the message | keyword-only filtering |

### 5. Good / Base / Bad Cases

- Good：`check_codex_installation()` validates Codex presence, then `probe_codex_app_server()` gates spawn before `initialize` is sent.
- Base：real Codex proxy that supports `codex app-server --help` may be accepted.
- Bad：`find_cli_binary("codex").or_else(|| find_cli_binary("claude"))` or using `--version` text as the only identity gate.

### 6. Tests Required

- Rust tests for no Codex-to-Claude fallback and Codex-specific missing error text.
- Rust tests for wrapper eligibility and `app-server` arg construction.
- Rust tests for control-plane-only Claude transcript not producing a session.
- Rust tests for mixed Claude transcript preserving real user/assistant messages.
- Rust tests proving normal user text containing `app-server` or `codex app-server` is not filtered, while pure command-token `codex app-server` is filtered.
- Frontend Vitest coverage for the matching loader fallback predicate.

### 7. Wrong vs Correct

#### Wrong

```rust
find_cli_binary("codex", None)
    .or_else(|| find_cli_binary("claude", None))
```

#### Correct

```rust
let _ = check_codex_installation(codex_bin.clone()).await?;
let probe_status = probe_codex_app_server(codex_bin.clone(), codex_args.as_deref()).await?;
if !probe_status.ok {
    return Err("Codex CLI is not app-server capable".to_string());
}
```

## Scenario: Codex managed runtime shutdown attribution

### 1. Scope / Trigger

- Trigger：修改 `WorkspaceSession` shutdown、`runtime/session_lifecycle.rs` stop/replacement/eviction、Codex stale-session cleanup、`runtime/ended` event、Runtime Pool pin/remove/recreate 逻辑。
- 目标：避免 internal cleanup 被误报成用户可见 turn loss，同时保留 active foreground work 的 recoverable runtime-ended path。

### 2. Signatures

- `RuntimeShutdownSource::{UserManualShutdown, ManualRelease, InternalReplacement, StaleReuseCleanup, SettingsRestart, AppExit, IdleEviction, CompatibilityManual}`
- `WorkspaceSession::mark_shutdown_requested(source: RuntimeShutdownSource)`
- `WorkspaceSession::mark_shutdown_had_active_work_protection()`
- `RuntimeManager::has_active_work_protection_for_session(engine: &str, workspace_id: &str, session_pid: Option<u32>) -> bool`
- `RuntimeManager::record_runtime_ended_for_session(..., session_pid: Option<u32>, record: RuntimeEndedRecord) -> bool`
- `stop_workspace_session_with_source(..., shutdown_source: RuntimeShutdownSource)`
- `terminate_workspace_session_with_source(..., shutdown_source: RuntimeShutdownSource)`

### 3. Contracts

- Stop path MUST mark shutdown source before process termination begins.
- `runtime/ended` MUST settle pending/timed-out requests even when event emission is suppressed.
- `runtime/ended` app-server event MUST be emitted only when affected work exists: active turns, pending requests, timed-out requests, background callbacks, or active-work protection captured before `record_stopping()`.
- A stale predecessor runtime end MUST NOT overwrite a newer successor runtime row or borrow the successor's active-work signal; runtime-ended row mutation and active-work visibility checks must be guarded by session identity such as process id.
- Internal replacement/stale cleanup/settings/app-exit/idle eviction with no affected work MUST remain diagnostics-only and MUST NOT create a reconnect-card event.
- Runtime Pool `pin` intent MUST survive row removal/recreation; row lifecycle MUST NOT be the only source of pin truth.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| internal replacement stop + no affected work | record runtime diagnostics, suppress `runtime/ended` event | append reconnect card to current conversation |
| manual release/close + pending request | settle request and emit `runtime/ended` with `shutdownSource` | silently drop pending request |
| active-work protection exists before stop | mark session active-work evidence before `record_stopping()` clears runtime row protection | check protection only after cleanup and lose evidence |
| predecessor exits after successor ready | preserve successor row and only record global diagnostics | write old exit into successor row |
| pinned runtime row removed | recreate row as pinned | lose pin because old row was deleted |

### 5. Good / Base / Bad Cases

- Good：`terminate_workspace_session_with_source(session, manager, RuntimeShutdownSource::ManualRelease)` records source and active-work marker before `record_stopping()`.
- Base：legacy cleanup can call `terminate_workspace_session(...)`, which maps to `CompatibilityManual` for backward compatibility.
- Bad：calling `session.mark_manual_shutdown()` or relying on generic `manual_shutdown_requested` for new stop paths.

### 6. Tests Required

- Rust tests for no-work internal cleanup suppressing app-server `runtime/ended`.
- Rust tests for pending/foreground work still emitting recoverable `runtime/ended` with `shutdownSource`.
- Runtime manager tests for pin -> remove -> recreate -> still pinned, and unpin -> recreate -> not pinned.
- `cargo test --manifest-path src-tauri/Cargo.toml --no-run` after touching shared runtime lifecycle code.

### 7. Wrong vs Correct

#### Wrong

```rust
session.mark_manual_shutdown();
runtime_manager.record_stopping("codex", &workspace_id).await;
```

## Scenario: Language server launch path and session lock isolation

### 1. Scope / Trigger

- Trigger：修改 `backend/app_server_cli.rs` 的 CLI `PATH` construction，或 `code_intel_lsp.rs` 的 provider spawn、reuse、eviction、shutdown。
- 目标：禁止 empty `PATH` component 让 workspace executable 获得隐式执行优先级；禁止 language server cold start 持有 global session lock 阻塞无关请求。

### 2. Signatures

- `build_cli_path_env(custom_bin: Option<&str>) -> Option<String>`
- `SemanticNavigationRuntime::initializer_for((SemanticProvider, PathBuf)) -> Arc<Mutex<()>>`
- `SemanticNavigationRuntime::session_for(provider, workspace_root) -> Result<Arc<LspSession>, String>`
- `SemanticNavigationRuntime::prepare(provider, workspace_root) -> Result<SemanticLifecycle, String>`
- `SemanticNavigationRuntime::query(...) -> Result<SemanticQueryResult, SemanticQueryFailure>`
- `SemanticLifecycle::{Starting, Indexing, Ready, Degraded}`
- `code_intel_prepare(workspace_id, file_path) -> Result<Value, String>`
- `spawn_language_server(provider, workspace_root, cache_root) -> Result<Arc<LspSession>, String>`
- `stop_session(session: &Arc<LspSession>)`

### 3. Contracts

- bare executable name（如 `jdtls`）的 `Path::parent()` empty value MUST NOT 进入 child `PATH`。
- same `(provider, workspace)` initialization MUST serialize，防止 double spawn。
- different provider 或 workspace MUST NOT 共用 initialization mutex。
- global sessions mutex 只允许保护 map read/remove/insert；MUST NOT 跨 `spawn_language_server(...).await`、`stop_session(...).await` 或 LSP initialize await。
- eviction MUST remove ownership under lock，then stop child outside lock；parallel insert 后 MUST 再执行 capacity eviction。
- semantic request timeout MUST be 15s；timeout 后发送 `$/cancelRequest`，但 live process/session MUST remain reusable。
- 只有 process exit、EOF、stdin write failure 等 transport/process fatal error 才允许 eviction；server-side cancellation、request timeout、单次 invalid location MUST NOT kill healthy provider。
- Java lifecycle 在 initialize 后保持 `indexing`，只允许 `language/status: ServiceReady` 转为 `ready`；普通 query success MUST NOT 伪造 Java ready。
- Java/TypeScript/JavaScript/Rust file open 后 750ms idle prewarm MUST 走 `code_intel_prepare`；JavaScript 与 TypeScript MUST 复用 `typescript-language-server` runtime。
- request timeout 时 command MUST 返回 `mode=semantic`、`fallbackReasonCode=request-timeout` 与 lifecycle，MUST NOT 自动触发 full-workspace heuristic scan。
- development/release MUST 使用不同 cache root；JDT workspace data dir MUST 持有 `.ccgui-owner.lock`，防止同 channel duplicate owner。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| custom bin=`jdtls` | reuse supported PATH entries，no empty component | 把 workspace current directory 注入 executable lookup |
| same key concurrent cold start | one initializer mutex / one reusable session | double spawn |
| Java + TypeScript concurrent cold start | independently progress | Java 30s initialize 持有 global lock |
| idle/dead eviction | remove under lock，kill outside lock | lock map while awaiting child kill |
| parallel insert reaches cap | insertion phase re-evaluates eviction | session map permanently exceed cap |
| Java 首次打开大型 Maven workspace | lifecycle=`indexing`，保留 JDT 继续建索引 | 15s timeout 后 kill/restart JDT |
| TypeScript/JavaScript request timeout | cancel request，session=`degraded` 且可重试 | 自动扫描整个 workspace 或销毁 tsserver |
| JDT `ServiceReady` | lifecycle=`ready` | 仅因一次 query success 提前 ready |
| dev 与 release 同时打开同一 workspace | channel cache 隔离 | 共用同一 JDT data dir |
| 同 channel duplicate JDT owner | deterministic owner-lock error | 两个 JDT 并发写同一 data dir |

### 5. Good / Base / Bad Cases

- Good：`Weak<Mutex<()>>` registry 提供 per-key coordination，dead weak entry 在后续访问时清理。
- Base：live same-key session 直接复用并刷新 `last_used`。
- Good：frontend 先显示 `indexing/degraded` + retry；provider 后台继续工作，下次 query 复用 warm session。
- Base：Rust/TypeScript initialize 成功即可 `ready`；Java 必须等待 `ServiceReady`。
- Bad：持有 `sessions.lock().await` 后调用 provider spawn/initialize/kill。
- Bad：无条件 push `Path::new(bare_name).parent()`。
- Bad：任何 `Err(String)` 都调用 `evict_session()`；这会把可恢复 timeout/cancellation 变成永久 cold-start loop。

### 6. Tests Required

- Rust test MUST assert bare executable 生成的 seed paths 不含 empty component。
- Rust test MUST assert same key initializer identity 相同，而 provider/workspace 任一不同则 identity 不同。
- Rust test MUST assert 15s timeout/cancellation is non-fatal、Java `ServiceReady` transition、channel cache isolation、JDT owner lock。
- Vitest MUST cover `code_intel_prepare` bridge、JavaScript 750ms prewarm、indexing timeout UI/no install hint。
- `cargo test --manifest-path src-tauri/Cargo.toml code_intel_lsp::tests`
- `npx vitest run src/services/tauri.test.ts src/features/files/utils/fileViewNavigationUtils.test.ts src/features/files/components/FileViewNavigationPanel.test.tsx src/features/files/components/FileViewPanel.test.tsx`
- `rustfmt --edition 2021 --check src-tauri/src/backend/app_server_cli.rs src-tauri/src/code_intel_lsp.rs`

### 7. Wrong vs Correct

#### Wrong

```rust
let mut sessions = self.sessions.lock().await;
let session = spawn_language_server(provider, workspace_root, cache_root).await?;
sessions.insert(key, session);
```

```rust
if query.await.is_err() {
    self.evict_session(provider, workspace_root, &session).await;
}
```

#### Correct

```rust
let initializer = self.initializer_for(&key).await;
let _initialization_guard = initializer.lock().await;
let cached = {
    let mut sessions = self.sessions.lock().await;
    sessions.get_mut(&key).map(|entry| {
        entry.last_used = Instant::now();
        Arc::clone(&entry.session)
    })
};
if let Some(session) = cached {
    return Ok(session);
}
let session = spawn_language_server(provider, workspace_root, cache_root).await?;
{
    let mut sessions = self.sessions.lock().await;
    sessions.insert(
        key,
        SessionEntry {
            session: Arc::clone(&session),
            last_used: Instant::now(),
        },
    );
}
Ok(session)
```

```rust
let fatal = query_error_is_fatal(session.alive.load(Ordering::SeqCst), &error);
if fatal {
    self.evict_session(provider, workspace_root, &session).await;
}
```

#### Correct

```rust
session.mark_shutdown_requested(RuntimeShutdownSource::ManualRelease);
if runtime_manager
    .has_active_work_protection_for_session("codex", &workspace_id, session.process_id)
    .await
{
    session.mark_shutdown_had_active_work_protection();
}
runtime_manager.record_stopping("codex", &workspace_id).await;
```
