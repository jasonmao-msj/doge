## Context

Doge 已把 Product compatibility 建模为 endpoint protocol：Codex=`openai-responses`、Kimi=`openai-chat-completions`、Claude=`anthropic-messages`。`projectProductTargetCatalogV1` 根据 Native canonical `api_protocols` 一次投影所有 Product target consumers。

Production `Doge APP` 已新增并保存：

| Public family | Incoming endpoint | Target | Upstream model |
|---|---|---|---|
| `claude-*` | Responses | Anthropic | raw prefix passthrough |

使用managed key的minimal `/v1/responses` request with `model=claude-opus-4-8` 已返回`status=completed`、text=`OK`。当前 `/v1/models` selected catalog包含`claude-opus-4-8`，但row无explicit protocol metadata；Native fallback仍只返回`anthropic-messages`。

Local managed config使用stable provider id `doge-token-matrix`和revision 1。new user由deterministic builder创建；old user在`ensureProductEngineReadyV1 -> account_product_v1_prepare(codex)`中、任何Session/Binding/Turn side effect前收敛stale same-id entry。startup `prepare(null)`只做catalog/credential reconciliation并保持非阻塞。

## Goals / Non-Goals

**Goals:**

- Claude-family row同时进入Codex与Claude，不进入Kimi。
- Codex真实Agent payload通过Responses→Anthropic route完成typed terminal。
- fresh/missing/revision 1 config自动收敛，user-owned providers与sessions不变。
- 所有Product target consumers与send-time validation保持single-source parity。

**Non-Goals:**

- 不扩展其他model family或local/custom provider。
- 不修改engine registry、Shared supported set、CLI protocol adapter或Conversation projection。
- 不创建local proxy，不恢复startup blocking prepare。

## Decisions

### Decision 1: Expand only the verified Claude-family fallback

metadata absent的Claude/Anthropic identity返回稳定顺序：

```text
[openai-responses, anthropic-messages]
```

explicit `api_protocols|supported_protocols|protocols` 仍是authority；explicit unknown/empty继续fail closed。Engine mapping不改，因此Codex+Claude自动可见，Kimi自动排除。

Alternatives：renderer concat会让Panel/Kanban/Shared漂移；broad all-protocol扩权缺少Chat Completions evidence；均拒绝。

### Decision 2: Reuse the single Product target projection

不新增per-engine catalog。Native输出canonical protocols后，`projectProductTargetCatalogV1`、target repair、send-time pair validation继续使用existing rows。Tests覆盖catalog id/runtime model separation与upstream order。

### Decision 3: Bump managed configuration revision to 2

Routing contract变化符合revision owner注释。Builder给fresh user写2；revision 1/missing在首次exact Codex send前deterministic replace。Repeated current prepare保持equivalent/no duplicate。startup catalog-only prepare不升级为三引擎mutation。

### Decision 4: Real Codex typed terminal gates delivery

Evidence ladder：saved route→minimal endpoint completed→real managed Codex system/tools/stream payload→requested model attribution + completed terminal。Picker row或minimal 200不能单独宣称ready。

## Cross-Layer Contract

```text
token2api claude-* Responses route
  -> /v1/models entitlement row
  -> ProductModelWire
  -> compatible_product_api_protocols
  -> account_product_v1_models
  -> parseProductModels
  -> projectProductTargetCatalogV1
  -> all Product target consumers
  -> frozen Codex ExecutionTarget
  -> revision-2 exact-engine prepare
  -> managed Codex runtime
```

No IPC field change is required。

## Engine Onboarding Matrix Decision

- A Identity：N/A，未新增engine。
- B Runtime：B2 model projection与Codex exact runtime model核对；无新dispatch。
- C Capability：registry/matrix unchanged；catalog contract更新。
- D Curtain：Codex adapter unchanged；真实turn核对typed terminal/history，无白名单变更。
- E Composer：single Product target catalog fixture更新。
- F Shared：supported set unchanged；existing exact pair validation核对。
- G UI：无新surface；Panel/Kanban parity来自same catalog。
- H i18n：无新copy。

## Risks / Trade-offs

- [Risk] minimal endpoint success但Codex tool/system payload失败 → real CLI turn mandatory，失败则不合入/删除route。
- [Risk] upstream以后移除route → exact target failure可见，禁止fallback；future explicit metadata可收窄。
- [Risk] revision bump写用户registry → 只替换same-id `source=doge-account` entry并使用既有transaction/rollback，保留siblings。
- [Trade-off] metadata-absent fallback依赖dated production evidence；长期上游应返回explicit `api_protocols`。

## Migration Plan

1. 保留已验证Claude Responses route并记录before/after evidence。
2. 扩Native fallback与tests，bump revision到2。
3. 运行real Codex/Claude-model turn与Hot Doge UI parity。
4. Release后fresh user直接写2；old usercatalog refresh后立即看到row，首次Codex send前迁移config。
5. Rollback时恢复fallback/revision behavior并删除remote route；不删除user providers/sessions。

## Open Questions

None。
