# model-provider-catalog-runtime Specification

## Purpose
TBD - created by archiving change converge-model-provider-catalog-runtime. Update Purpose after archive.
## Requirements
### Requirement: Catalog Sources MUST Follow One Deterministic Precedence

Every engine model catalog MUST merge sources in `provider-owned runtime/configured > public user-configured > public generated fallback` order with deterministic dedupe. For a managed provider request, disk/global provider-specific configured entries MUST NOT be treated as public entries. Dedupe MUST use normalized runtime model identity, falling back to model ID when no runtime value exists.

#### Scenario: provider and public catalog contain same model

- **WHEN** a managed provider model and a public model resolve to the same normalized runtime model identity
- **THEN** the provider-owned metadata and label MUST win
- **AND** the model MUST appear once

#### Scenario: provider catalog appends public models

- **WHEN** a managed Claude Code, Codex, or Kimi provider catalog is requested
- **THEN** the result MUST include models configured by that provider
- **AND** it MUST append public user-configured and generated fallback models that do not duplicate provider models
- **AND** it MUST NOT include configured models owned only by another managed provider or by the disk/global provider

#### Scenario: local profile preserves global catalog

- **WHEN** the request omits `providerProfileId` or identifies the engine's local/disk profile
- **THEN** the system MUST preserve the existing disk/global model catalog behavior
- **AND** it MUST NOT reinterpret the local profile as a managed isolated catalog

### Requirement: Provider And Protocol MUST Be Orthogonal Metadata

Catalog entries MUST carry provider identity separately from API/wire protocol and MUST preserve source/provenance across Rust、daemon and TypeScript DTOs. Provider catalog request scope MUST remain a separate `providerProfileId` fact and MUST NOT be inferred from model name prefixes.

#### Scenario: backend knows provider profile scope

- **WHEN** `get_engine_models` receives a managed `providerProfileId`
- **THEN** Desktop and daemon adapters MUST pass that exact scope to provider config resolution
- **AND** frontend cache and in-flight request identity MUST include `engineType + providerProfileId`
- **AND** the frontend MUST NOT reclassify the scope from a model prefix table

#### Scenario: managed profile is missing

- **WHEN** a requested managed provider profile no longer exists or its model configuration is invalid
- **THEN** model catalog resolution MUST return a diagnosable provider-scoped error
- **AND** it MUST NOT silently retry with the local/disk profile

### Requirement: Refresh Failure MUST Preserve Last-Good Catalog

Catalog refresh MUST replace cache only after successful validation; failure MUST retain last-good entries with error diagnostics. A stale response for a previously active provider scope MUST NOT replace the currently active scope.

#### Scenario: provider scope changes before the new catalog returns

- **WHEN** active thread binding changes from local/global or provider A to managed provider B
- **THEN** frontend MUST immediately publish provider B's last-good catalog when one exists
- **AND** when provider B has no last-good catalog, frontend MUST expose an empty/loading catalog until B resolves
- **AND** models from local/global or provider A MUST NOT remain selectable during the request

#### Scenario: provider refresh fails

- **WHEN** a previous successful provider-scoped catalog exists
- **AND** refreshing that provider fails
- **THEN** the previous catalog MUST remain selectable
- **AND** diagnostics MUST identify the engine and provider scope

#### Scenario: provider responses arrive out of order

- **WHEN** the user switches from provider A to provider B before A's catalog request completes
- **AND** provider A responds after provider B
- **THEN** provider A's response MUST NOT replace provider B's visible catalog
- **AND** each provider request/cache identity MUST remain independent

### Requirement: Generated Fallback MUST Have One Owner And Freshness Evidence

Each engine MUST have one generated fallback roster with source、lifecycle and last verification metadata.

#### Scenario: duplicate fallback owners diverge

- **WHEN** frontend and backend fallback rosters differ
- **THEN** the catalog parity gate MUST fail

### Requirement: Codex Generated Fallback MUST Cover Current Selectable Models

Codex generated fallback catalog MUST enumerate the current non-legacy models exposed by the supported Codex CLI model selector. Runtime/configured entries MAY override matching metadata, but an unavailable or partial runtime catalog MUST still leave every current selectable model visible in every Composer model surface.

#### Scenario: Codex runtime catalog is unavailable

- **WHEN** Codex `model/list` is unavailable, empty, partial, or not yet connected
- **THEN** the fallback catalog MUST include `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark`
- **AND** `gpt-5.6-sol` MUST remain the default

### Requirement: Atomic Catalog MUST Load Kimi Grok And OpenCode Bindings

Atomic Shared/Home Provider Target catalog MUST load Kimi、Grok and OpenCode local/managed
Profiles and Models using the same `engine + providerProfileId` scope used by Runtime dispatch.

#### Scenario: profile loader returns all Shared CLIs

- **WHEN** Atomic catalog loads Provider Profiles
- **THEN** it MUST include Claude、Codex、Kimi、Grok and OpenCode groups
- **AND** canonical local sentinel rows MUST retain `source=disk`

#### Scenario: models remain binding scoped

- **WHEN** a Kimi、Grok or OpenCode managed Profile is expanded
- **THEN** `getEngineModels` MUST receive that exact Engine and Provider Profile
- **AND** Models from local config or another managed Profile MUST NOT leak into the row

#### Scenario: one new CLI catalog failure is isolated

- **WHEN** one newly supported CLI Profile or Model request fails
- **THEN** its binding MUST expose a scoped error
- **AND** other CLI/Profile groups MUST remain usable

### Requirement: Shared Validation MUST Have Catalog Authority For Every Supported CLI

Shared create、selection persistence、V2 turn revalidation and projection availability MUST use
the same supported CLI matrix and MUST fail closed when the selected catalog authority is absent.

#### Scenario: canonical local target reaches Shared creation

- **WHEN** a resolved Kimi、Grok or OpenCode local Target reaches the Rust Shared boundary
- **THEN** backend MUST load that CLI's local validation catalog
- **AND** MUST validate `modelCatalogEntryId + runtime model` before creating or persisting the Session

#### Scenario: managed provider is missing

- **WHEN** a projection snapshot references a missing managed Provider under any supported CLI
- **THEN** `providerAvailable` MUST be `false`
- **AND** an absent catalog MUST NOT be interpreted as an available Provider

### Requirement: OpenCode Shared Validation MUST Reuse Runtime Catalog Authority

OpenCode local Model discovery and Shared create/send validation MUST use the same last-known-good runtime catalog authority. A successful `opencode models` discovery MUST update the catalog snapshot used by synchronous Shared validation. A failed refresh MUST NOT erase a previous successful snapshot, and generated catalog data MAY only be used as fallback when no runtime snapshot exists.

#### Scenario: runtime-only OpenCode Model remains valid

- **WHEN** `opencode models` returns a Model that is absent from the generated fallback
- **AND** the user selects that Model for a Shared Session
- **THEN** Shared creation and subsequent send validation MUST accept the exact catalog entry/runtime Model pair

#### Scenario: failed refresh preserves last-known-good catalog

- **WHEN** OpenCode runtime discovery previously succeeded and a later refresh fails
- **THEN** the last-known-good runtime catalog MUST remain the validation authority
- **AND** the system MUST NOT silently replace it with a smaller generated fallback

### Requirement: Catalog Refresh MUST Use One Atomic Conversation Scope

模型目录刷新 MUST 从同一个 active conversation snapshot 获取 engine 与 provider identity，不得组合新 thread 的 provider 与尚未收敛的 global engine。

#### Scenario: Cross-engine thread navigation observes transient global engine

- **WHEN** 用户从 Claude thread 切换到 Codex thread，或反向切换
- **AND** global engine 切换尚未完成
- **THEN** catalog request MUST 使用目标 thread 自身的 engine 与 provider scope
- **AND** 系统 MUST NOT 向一个 engine 发送属于另一个 engine 的 provider profile

#### Scenario: Transient scope cannot be validated

- **WHEN** active conversation scope 缺少必要 identity 或 engine/provider 归属不一致
- **THEN** 系统 MUST 跳过该 transient refresh
- **AND** last-good catalog MUST 保持可用，不得被空结果覆盖

#### Scenario: Refresh returns semantically unchanged catalog

- **WHEN** catalog refresh 返回与当前 catalog 内容等价的 entries
- **THEN** frontend MUST 保持现有 state identity
- **AND** 不得仅因数组引用变化触发下游 render

### Requirement: Managed Account Defaults SHALL Load Their Own Provider-Scoped Catalog

When an authenticated account preparation selects `doge-token-matrix` as the default provider for an eligible engine, the UI MUST request and use that provider's model catalog before it derives a new-session model selection. A local/disk catalog entry MUST NOT be reused under the managed profile identity.

#### Scenario: active engine changes after account preparation

- **WHEN** the App Shell activates an eligible managed Codex or Claude engine after successful account preparation
- **THEN** the provider-scoped catalog request MUST use `doge-token-matrix`
- **AND** any stale local/disk model selection outside that catalog MUST be repaired or omitted according to the existing model-catalog contract
