## Context

Current managed Codex provider:

```toml
model_provider = "DogeTokenMatrix"

[model_providers.DogeTokenMatrix]
base_url = "https://token-matrix.com"
wire_api = "responses"
requires_openai_auth = true
env_key = "OPENAI_API_KEY"
```

The active Codex binary `0.151.0-alpha.7.2` bundles:

| slug | use_responses_lite | input modalities |
|---|---:|---|
| `gpt-5.6-sol` | `true` | text, image |
| `gpt-5.6-terra` | `true` | text, image |
| `gpt-5.6-luna` | `true` | text, image |

For custom API-key providers Codex does not reliably refresh the ChatGPT Codex model manifest. Production `GET /models?client_version=...` also currently fails with `502` because the selected upstream manifest request returns `404`. Codex therefore keeps bundled Lite metadata. Lite requests move tools into their private `additional_tools` carrier and token2api intentionally skips hosted image injection.

Doge already normalizes native `image_generation_call`/`image_generation_end` from live and history, accepts base64 `result`, and renders inline generated-image cards. The missing link is tool exposure before the request reaches the model.

## Decisions

### Decision 1: Materialize from the exact launch binary

Only for `providerProfileId=doge-token-matrix`, before app-server spawn:

```text
resolved Codex binary
  -> codex debug models --bundled
  -> bounded stdout + successful exit
  -> parse full JSON catalog
  -> patch exact three slugs use_responses_lite=false
  -> atomic write managed-model-catalog.json in isolated provider home
  -> launch override model_catalog_json=<absolute path>
```

This keeps all other model metadata byte/semantic-equivalent to the binary catalog. Doge owns only the three compatibility overrides supported by production evidence.

### Decision 2: Launch-scoped override, not persistent global config

`model_catalog_json` is added to the managed app-server invocation. It is not written to `~/.codex/config.toml` and not applied to local/custom profiles. The provider home artifact is private runtime state and may be replaced atomically on every cold launch; repeat launches are idempotent.

### Decision 3: Fail closed before native side effects

Materialization validates:

- command success;
- bounded stdout size;
- top-level object + `models` array;
- all three exact slug entries exist exactly once;
- each targeted entry is an object and accepts boolean `use_responses_lite=false`;
- serialized result remains within the configured bound.

Any failure aborts managed Codex activation before `thread/start`、Binding provisioning or Turn send. Secret env is not required for `debug models --bundled` and MUST NOT be logged or serialized.

### Decision 4: Preserve existing image projection

No renderer heuristic is added. Success requires native output evidence:

```text
response.output_item.* image_generation_call
  -> Codex app-server/raw event
  -> existing generatedImage adapter
  -> existing turn-linked image card
```

Assistant text such as “已生成” is never acceptance evidence.

## Cross-Layer Contract

```text
Product exact Codex target
  -> send-time managed engine readiness
  -> resolved binary + isolated provider home
  -> managed catalog materializer
  -> model_catalog_json launch override
  -> full Responses request (non-Lite)
  -> token2api account/channel hosted image bridge
  -> upstream image_generation_call payload
  -> existing realtime/history generated-image projection
```

No renderer IPC field changes are required.

## Engine Onboarding Matrix Decision

- A Identity：N/A，未新增 engine。
- B Runtime：B10 existing Codex launch/profile owner 变更；不新增 dispatch。
- C Capability：matrix/registry unchanged；runtime compatibility artifact only。
- D Curtain：D1-D9 unchanged；用真实 live + history image artifact 验证既有链路。
- E Composer：unchanged；Product target catalog remains authority。
- F Shared：supported set and canonical contracts unchanged；managed Codex hidden binding consumes the same launch owner automatically。
- G UI：no new surface or copy。
- H i18n：no new copy。

## Validation And Error Matrix

| Case | Expected | Forbidden |
|---|---|---|
| managed Codex + exact GPT-5.6 entry | materialize non-Lite catalog and launch | rely on bundled Lite metadata |
| local/custom Codex provider | preserve current launch/config | inject Doge catalog override |
| binary updates catalog schema but remains valid | regenerate from new binary and preserve unknown fields | reuse stale hardcoded full catalog |
| target slug missing/duplicate | fail activation with diagnostic | continue with partial patch |
| command non-zero/timeout/oversized output | fail before session side effect | fallback to Lite |
| image tool returns base64 result | existing generated-image card completes | treat assistant text as success |

## Good / Base / Bad Cases

- Good：current binary exports three entries, materializer changes only three booleans, token2api records real image output, Doge renders preview。
- Base：a future binary already sets one target to false; materializer preserves it and patches the remaining targets, producing the same effective contract。
- Bad：commit a complete upstream models snapshot or silently ignore a failed materializer and launch managed Codex with Responses Lite。

## Migration Plan

1. Add focused materializer and command/output validation tests。
2. Wire only managed Codex launch owner and pass absolute launch override。
3. L3 verify current binary catalog, malformed/oversized/non-zero cases, local-provider exclusion and repeated materialization。
4. Run real managed CLI image turn; require image accounting + native image event。
5. Start Hot Doge for visual acceptance and history reload。
6. Rollback removes launch override/materializer; provider config and user sessions remain untouched。

## Open Questions

None。
