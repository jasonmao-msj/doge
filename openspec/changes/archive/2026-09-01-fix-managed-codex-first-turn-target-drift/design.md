# Design: fix-managed-codex-first-turn-target-drift

## Authority model

Product Native managed send 的 authority 顺序固定为：

```text
Product entitlement snapshot
  -> projectProductTargetCatalogV1
  -> resolveProductManagedExecutionTargetV1
  -> Composer selectedAtomicTarget
  -> MessageSendOptions frozen model identity
  -> useThreadMessaging modelForSend
  -> send_user_message(model, modelCatalogEntryId, effort)
  -> Codex turn_context.model
```

`config.toml.model` 只作为 fail-safe fallback，不能成为 Product UI 的 parallel target authority。fallback 仍必须是 Product channel 允许且具备 image capability 的 `gpt-5.6-sol`。

## Frontend convergence

- `nativeProductTarget` 已是现有 canonical resolver，复用它，不新增第二套 compatibility/model-selection helper。
- `selectedAtomicTarget` 在 Native Product managed session 中取 `nativeProductTarget ?? nativeSessionTarget`。
- 当 session 确认为 managed Product，但 canonical target 尚未 resolved 时，`effectiveSubmitDisabled=true`；用户仍可编辑，不能发送。
- managed Native target resolved 后，Composer 在 send boundary 将完整 `nativeExecutionTarget` 写入 `MessageSendOptions`；Engine、Provider、catalog/runtime model 与 effort 不能被平铺字段表达成非法组合。该 snapshot 与 UI trigger 使用同一 object。
- `useThreadMessaging` 的 target 优先级为 `nativeExecutionTarget` > create-session frozen target > per-thread resolver/cache；显式 Native snapshot 的 Engine/已知 Provider binding 不一致时 fail closed。

## Backend migration

- 新增 `ACCOUNT_MANAGED_CODEX_MODEL = "gpt-5.6-sol"`，Codex recipe/read-detail/test 复用常量。
- `ACCOUNT_MANAGED_CONFIGURATION_REVISION` 从 2 升到 3。revision 3 表示：Claude Responses routing contract + Codex Product-safe fallback model。
- exact-engine prepare 继续使用 existing transactional builder/atomic replace/semantic verification；不新增 migration file，不触碰 user global `~/.codex`。
- `ACCOUNT_MANAGED_KIMI_MODEL` 保持 `gpt-5.5`，避免跨 engine 默认值耦合。

## Shared image artifact convergence

- provider-scoped rollout 的 completed `response_item/image_generation_call` 仍是唯一 success authority；assistant prose 与 markdown link 不参与判定。不能假设 Codex app-server realtime surface 会转发该 private response item。
- Shared terminal commit 使用 frozen `providerProfileId + nativeSessionId + runtimeTurnId` 精确解析对应 rollout；只接受 metadata turn id 与当前 attempt runtime turn 完全一致的 image item，禁止拿同 session 旧图补当前 Turn。
- terminal reconcile 只读 rollout latest 64 MiB tail，单行 32 MiB hard cap且超限流式丢弃；随后执行 20 MiB bounded Base64 decode，校验 PNG/JPEG/WebP/GIF magic，并按 image bytes 的 SHA-256 写入 App Data `generated-images/shared/`。write 使用 temp + fsync + rename；同内容 idempotent reuse。
- reconcile 只生成 compact canonical `ArtifactRef`：`artifactId` 复用 native image call id、`sha256` 为内容 hash、`locator` 为稳定 absolute local path。SQLite、projection checkpoint 与 frontend state 禁止持久化完整 Base64。
- Existing `extract_explicit_artifact_refs -> turnCommitted.artifactRefs -> SharedProjector::GeneratedImage -> GeneratedImageRow` 是唯一 history/render path；不新增 Shared-only image renderer。
- Projection generated-image item id 使用 `artifactId`，与 live raw item identity 对齐，避免 terminal canonical refresh 产生重复图片。
- Shared V2 committed boundary 在设置 terminal barrier 后复用现有 `refreshThread` history loader，使当前打开的时间线立即 reconcile canonical projection；refresh failure 只写 diagnostic，不能把已 durable committed 的 Turn 改判失败。
- Existing `read_local_image_data_url` path policy 仅新增 App Data `generated-images/shared/` 这一条 canonicalized root；不得放宽任意 absolute path。materialization size bound 与现有 20 MiB inline renderer bound 对齐，保证 canonical completed artifact 可实际渲染。

## Failure matrix

| State | Behavior |
|---|---|
| Product managed Native target resolved | frozen exact model send |
| Product snapshot ready but target unresolved | submit disabled; no fallback |
| revision-2 managed Codex config | exact prepare upgrades to revision 3 + Sol fallback |
| Local/disk/custom Codex | existing catalog/config behavior unchanged |
| explicit Terra/Luna selection | exact selected runtime sent; config Sol fallback not consulted |
| Shared completed native image in exact rollout Turn | terminal reconcile + bounded persist + canonical image artifact + generatedImage projection |
| image exists only in older Turn of same session | ignore; no stale-image attachment |
| image bytes invalid / oversized | no false completed image artifact; prose alone remains non-authoritative |
| canonical image committed while Shared canvas is open | terminal boundary refreshes canonical projection before processing cleanup |
| generated image locator is under managed App Data root | allowed local preview read; all sibling/external paths remain denied |

## Verification level

L3：cross-layer provider/model routing + persisted managed configuration migration。

- Focused Composer/messaging Vitest。
- Rust account configuration tests + Codex focused tests where affected。
- `npm run typecheck`、target ESLint、`npm run check:runtime-contracts`。
- `cargo check --lib`、strict OpenSpec validation。
- Hot Doge exact new-session immediate Native + Shared image-generation smoke；L4 full suites由 CI。
