# Proposal: fix-managed-codex-first-turn-target-drift

## Why

Doge v0.1.13 已能让 managed Codex 的 `gpt-5.6-sol/terra/luna` 生成真实图片，但 Native managed Codex 新会话存在首轮 target race：UI 在失败后显示 `gpt-5.6-sol`，实际 Codex `turn_context` 与 `/responses` 请求却使用 `gpt-5.5`。

生产证据已闭合：request `dfd3c3d3-9b78-468e-99b1-53ebca4051ae` 被 token2api 以 `channel pricing restriction` 拒绝，原因是 Doge OpenAI channel 只允许 `gpt-5.6-sol/terra/luna` 与 `ark-code-latest`，不允许 `gpt-5.5`。同一 v0.1.13 在该失败前已用 `gpt-5.6-sol` 连续产生两个 completed `image_generation_call`，因此问题不是 image bridge 整体失效，而是 presentation target 与 dispatch target 分裂。

根因有两层：

1. managed Codex isolated `config.toml` 仍硬编码 `model/review_model = gpt-5.5`；任何 model-omitted path 都会落到被 Product channel 禁止的模型。
2. Existing Native Product Composer 的 `selectedAtomicTarget` 没有优先使用 canonical `nativeProductTarget`，send options 也不冻结 visible target。新 real thread 在 durable selection/catalog hydration 前立即发送时，会读取 transient/global fallback；UI 随后才把 `gpt-5.6-sol` 写回 cache/durable metadata。
3. Shared CLI 的 provider-scoped native rollout 虽记录 completed `image_generation_call` 与完整 PNG Base64，但 Codex app-server realtime surface 不会上报该 `response_item`。Rust canonical accumulator 因而无事件可转成 `ArtifactRef`，terminal projection 只剩 assistant prose，刷新后的 Shared 时间线没有图片。

## What Changes

- 将 managed Codex fallback model/review model 改为 `gpt-5.6-sol`，提升 managed configuration revision，使 existing installs 在下一次 exact-engine prepare 自动升级。
- Existing Native Product Composer 使用 canonical `nativeProductTarget`；managed target 未 resolved 时禁发，不回落 global/local model。
- 每次 managed Native send 显式携带 frozen `modelCatalogEntryId + runtime model + effort`；messaging boundary 优先消费该 snapshot。
- Shared Codex terminal commit 以 frozen `providerProfileId + nativeSessionId + runtimeTurnId` 精确 reconcile provider-scoped rollout，对本轮 image result 做 bounded decode、content-addressed atomic persistence，并以 canonical image `ArtifactRef` 进入 `turnCommitted`；Projection 复用既有 `generatedImage` renderer。
- 增加首轮立即发送、catalog hydration race、UI/runtime identity、revision-2 migration regression。

## Non-goals

- 不修改 token2api 源码或给 `gpt-5.5` 增加 Doge channel pricing。
- 不改变 Kimi managed 默认模型 `gpt-5.5`。
- 不改变 Local/disk/custom Codex provider semantics。
- 不把 multi-megabyte Base64 image payload 写入 Shared SQLite 或长期 React state。

## Acceptance

- Native managed Codex 新会话创建后立即发送，UI `gpt-5.6-sol` 与 Codex `turn_context.model` 一致。
- Product catalog/target 未 resolved 时 Composer 保留输入并禁发，零 Session/Turn fallback side effect。
- revision-2 existing install 经 exact Codex prepare 生成 revision-3 config，`model/review_model=gpt-5.6-sol`。
- `gpt-5.6-sol` 生图返回 native completed `image_generation_call`；不再出现 `gpt-5.5 channel pricing restriction`。
- Shared CLI completed image 在 live terminal、refresh 与 restart 后都渲染真实图片；assistant “已生成”文字不能单独判定成功。
- Existing product user 安装升级后无需清配置、重新登录或重建 Shared Session；next managed Shared Codex Turn 自动使用新 target/config/artifact contract。
