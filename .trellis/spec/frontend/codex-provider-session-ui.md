# Codex Provider Session UI Contract

## Scenario: Codex provider selection, binding display, and fork UI

### 1. Scope / Trigger

- Trigger: 修改 `src/features/app/**` 的 workspace menu/sidebar/pinned list，`src/features/threads/**` 的 start/fork/thread metadata flow，`src/features/composer/**` 的 active provider label，或 `src/services/tauri.ts` 的 Codex command payload。
- 目标：UI 只在创建/分叉时选择 Codex provider；已有会话显示并保持 thread metadata 中的 provider binding；不能从供应商管理的全局状态推导当前会话 provider。

### 2. Signatures

- Constants: `CODEX_DISK_PROVIDER_PROFILE_ID = "__disk__"`, `CODEX_DISK_PROVIDER_PROFILE_NAME = "codex-tui/default-config"`。
- `CodexProviderProfileOption { id, name, source, availability? }`。
- `CodexProviderProfileSelection { providerProfileId?, providerProfile? }`。
- Service bridge: `startThread(workspaceId, { autoSession?, providerProfileId? })`。
- Service bridge: `forkThread(workspaceId, threadId, messageId?, { providerProfileId?, targetUserTurnIndex?, targetUserMessageText?, targetUserMessageOccurrence?, localUserMessageCount? })`。
- Thread metadata fields: `providerProfileId`, `providerProfileSource`, `providerProfileName`, `providerAvailability`, `sourceLabel`。
- Runtime hooks/helpers: `startThreadForWorkspace(..., { providerProfileId?, providerProfile? })`, `forkThreadForWorkspace(..., { providerProfileId?, providerProfile? })`, `extractProviderBindingFromStartedThread`, `providerBindingFromSelectedProfile`。
- Display helper: `resolveCodexProviderLabel(thread: ThreadSummary) -> string | null`。

### 3. Contracts

- 非 product/local expert 的 New Codex conversation entrypoints MUST present disk profile plus managed provider options when provider profiles are available，且 Disk 为默认。统一产品订阅进入 `productEntitlement.status="ready"` 后例外：Home / Shared / Existing Native modification 统一使用 `ProductEngineModelSelect`，隐藏 disk/provider/configuration，选择固定 `providerProfileId="doge-token-matrix"`、display label `Doge`。
- Frontend payload MUST pass `providerProfileId` for selected Codex provider. Blank/undefined means intentional disk default only when the entrypoint has no provider selector or selected disk maps to `__disk__`.
- Codex start in-flight dedupe key MUST include `workspaceId`, `providerProfileId` defaulted to `__disk__`, `folderId/root`, and auto-session identity. Starts with different provider profile ids MUST NOT share a promise.
- `ensureThread` reducer MUST merge provider metadata without erasing existing metadata when a later action omits provider fields.
- Thread list, pinned list, sidebar snapshot, live turn events, and loaded catalog rows MUST preserve provider metadata fields.
- Provider label display MUST derive from thread metadata: `providerProfileName`, then `sourceLabel`, then non-disk `providerProfileId`. Non-Codex threads return no Codex provider label.
- When sidebar provider labels are enabled, Codex `__disk__` and Claude Code `__local_settings_json__` MUST render the stable technical tag `local`; internal profile names such as `codex-tui/default-config` MUST remain hidden.
- Composer footer/button area MAY show the active Codex provider label, but the label MUST come from active thread metadata and not from supplier-management active state.
- Codex stale recovery fresh continuation and fork continuation MUST inherit the source thread's non-empty `providerProfileId` from thread metadata. Blank/whitespace provider ids MUST be normalized away so legacy disk/default behavior remains intentional.
- Provider metadata resolvers passed into stable messaging/AppShell context paths MUST use ref-backed latest state or another identity-stable mechanism. They MUST NOT depend directly on `threadsByWorkspace` if that would recreate send/recovery callbacks on each thread list update.
- Fork UI MUST default selected provider to parent thread binding. Provider-selected message fork MUST send parent thread id, selected provider id, target user turn index/text/occurrence, and local user message count so backend can resolve native Codex anchors.
- Provider-selected Codex message fork MUST create/activate a child thread and preserve parent row/metadata. It MUST NOT use the destructive rewind `renameThreadId(parent -> child)` / `hideThread(parent)` transition.
- Supplier management Codex cards manage reusable provider profiles. They MUST NOT expose a global enable action or active styling that implies already-created conversations will switch provider.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| 用户从 workspace menu 新建 Codex | 显示 disk + managed submenu，payload 包含 selected `providerProfileId` | 使用供应商 tab 的 active provider |
| product-ready Composer 修改 Native conversation | 只显示 Codex/Claude/Kimi product panel，选择产出 `doge-token-matrix` target | 回落 legacy Grok/OpenCode/channel picker 或原地改 binding |
| 两次同 workspace 同 provider start | 复用同一个 in-flight promise | 创建重复 pending/backend start |
| 两次同 workspace 不同 provider start | 各自独立 start | 因 workspace 相同而 collapse |
| catalog row 带 provider metadata | reducer/list/display 保留字段并显示 label | 后续 ensureThread 丢字段 |
| active Codex thread 有 provider name | composer 显示 provider tag | 显示当前供应商管理选中项 |
| stale recovery fresh/fork continuation | 从 source thread metadata 透传 `providerProfileId` | 丢失 provider 后默认切回 disk |
| thread metadata 更新 | provider resolver 读到最新 metadata 且函数身份稳定 | 因 resolver identity 抖动触发 AppShell/context update loop |
| fork 选择不同 provider | 发送 selected provider + native anchor hints，parent 保持可见 | hide/rename parent 或 seed transcript |
| provider unavailable | label/status 可区分 unavailable | 静默显示为 disk |

### 5. Good / Base / Bad Cases

- Good: `startThreadForWorkspace` 使用 `providerBindingFromSelectedProfile`，以 `providerProfileId ?? "__disk__"` 参与 in-flight key，并把 backend response/provider fallback 写入 `ensureThread`。
- Good: `resolveCodexProviderLabel` 对 managed Codex thread 使用 metadata label，对 Codex disk 与 Claude local thread 显示 `local`，且不暴露 raw sentinel/internal profile name。
- Base: 非交互式 Codex start 未传 provider 时视为 disk default，并由 backend 记录 disk binding。
- Bad: reducer 更新 thread 时只保留新 action 字段，导致 catalog provider metadata 被 undefined 覆盖。
- Bad: composer 从 vendor settings 读取当前 provider label，而不是 active thread metadata。
- Bad: fork from message 对 provider-selected fork 复用 rewind 的 parent rename/hide path。

### 6. Tests Required

- Vitest for `startThread` / `forkThread` service payload mapping, including `providerProfileId` and anchor hint normalization.
- Vitest for workspace menu provider submenu rendering, disk default, managed provider options, unavailable state, and action payload.
- Vitest for Codex start in-flight reuse: same provider reuses, different provider does not.
- Vitest for reducer preserving provider metadata across `ensureThread`, catalog load, live events, and thread snapshots.
- Vitest for `useCodexMessageRecovery` provider inheritance: fresh continuation and fork continuation pass non-empty `providerProfileId`, while blank ids are omitted.
- Vitest for `resolveCodexProviderLabel`, sidebar/thread list/pinned list badges, and composer provider tag rendering.
- Vitest for provider-selected fork preserving parent metadata and producing child provider binding.

### 7. Wrong vs Correct

#### Wrong

```ts
const startKey = `${workspaceId}:codex`;
await startThread(workspaceId);
```

#### Correct

```ts
const providerProfileKey = providerProfileId ?? "__disk__";
const startKey = `${workspaceId}:codex:${providerProfileKey}:${folderId ?? "__root__"}:${autoSessionKey}`;
await startThread(workspaceId, { providerProfileId });
```

#### Wrong

```ts
const label = activeVendor.codex.currentProviderName;
```

#### Correct

```ts
const label = resolveCodexProviderLabel(activeThread);
```
