# Design: Durable Execution Target and Managed Runtime Restore

## Authority order

```text
durable session execution target
  > in-memory session catalog projection
  > legacy selectedModelByThread client cache
  > catalog/default model
```

Shared Session 使用独立 authority：

```text
shared_sessions_v2.selected_target_json
  > legacy shared-sessions/<workspace>/<session>/meta.json selectedTarget
  > renderer selectedNextTarget（仅 optimistic mirror）
  > no target / blocked
```

Shared existing-session cold start 不允许回退 global/default model。Product catalog resolver
只有在 `selectedNextTarget` 已经是完整 resolved target 时，才可用于旧 identity alias 的
canonical repair；`null`/partial 代表 hydration 尚未完成或 legacy data，不是用户选择。

The durable key is the existing canonical session metadata key, scoped by
`workspaceId + canonical session identity + engine`. A target is accepted only when its
provider, catalog id, runtime model and effort pass the existing normalization rules.
`modelCatalogEntryId` remains the public catalog identity; `model` remains the runtime identity.

## Durable record

`EngineProviderBinding` gains optional fields so old metadata files remain readable:

```text
providerProfileId
providerProfileSource
providerProfileName
providerAvailability
modelCatalogEntryId?
model?
reasoningEffort?
```

The binding is written both when a user selects a model/effort for an existing native session and
at the send/continuation boundary before a new turn side effect is considered committed. The
selection path uses the `record_session_execution_target` Tauri command and preserves the existing
client cache as an optimistic UI mirror. Catalog entries project these fields to the renderer.
Existing callers that only know provider binding retain their behavior and leave target fields
absent.

## Renderer hydration

The session catalog parser exposes the optional target fields. `useSelectedComposerSession` uses
the catalog-provided target for the active canonical session before checking `composer` client
storage. During first-paint, the full session catalog is intentionally deferred for startup
responsiveness, so the active native session also performs a targeted
`workspaceId + sessionId + engine` durable read through Tauri/daemon IPC. A durable target is
written into the local cache as a compatibility/read-through cache, but cache writes never
override a non-empty durable target. If durable metadata is unavailable, legacy cache and then
the existing engine default path remain valid fallbacks.

`load_shared_session` 与 sidebar summary 从 Shared V2 row 只读投影 selected target/engine；
V2 row 缺失时才兼容 legacy meta。该 cold-start read 不更新 V2 row，也不改写 legacy meta。
Composer mount 在 target 未 hydrate 时只保持 submit blocked，不调用 selection persistence；
因此 history loader 的 generation guard 只会保护真实用户 mutation，不会保护 mount default。

## Managed runtime restore

On engine restore:

1. detect persisted engine and inspect the managed toolchain when the provider is managed;
2. resolve bundled/external selected binary and verify it through the existing engine manager;
3. put the verified binary in the process cache;
4. call `account_engine_v1_activate` for managed Codex/Claude;
5. use generic `switch_engine` only for disk/native providers.

If inspect/verification fails, the restore result remains safe and observable; it must not silently
replace a durable managed target with a global default.

## Compatibility and recovery

- Old metadata JSON deserializes because target fields are optional.
- Existing provider-only write sites remain valid through a target-optional binding input.
- Continuation persists the destination target together with provider binding, so a newly created
  destination session can hydrate the same model after restart.
- A failed durable write or malformed target is surfaced as a typed/normalized error; no fallback
  target is persisted as if it were user-selected.
