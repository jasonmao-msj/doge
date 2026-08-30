# Codex 跨协议使用 Claude 模型

## Goal

让 doge Product 模式中的 Codex 可以选择并调用经 token2api Responses→Anthropic route 转换的 Claude-family models。新用户无需配置，已经安装旧版本的用户更新后通过 managed revision 幂等迁移自动生效。

## Requirements

- OpenSpec change：`enable-cross-protocol-product-engine-models`。
- Product model compatibility 继续由 endpoint-level protocol facts 驱动；Renderer 不按名称扩权。
- 无 explicit metadata 的已验证 Claude-family row 归一为 `anthropic-messages + openai-responses`。
- Codex、Claude 两个 engine 可看到 Claude-family row；Kimi 不可看到。
- Composer、existing Native picker、Shared、Panel/Kanban、target repair 与 send-time validation 复用同一 `projectProductTargetCatalogV1`。
- new user 生成 current `doge-token-matrix` managed config；revision 1/missing 的 old user 在首次 managed Codex send side effect 前自动迁移。
- login/Home 保持非阻塞；不恢复 startup engine config/install gate。
- local/custom providers、global CLI home 与 existing Native Session binding 不被改写。

## Acceptance Criteria

- [ ] Product Codex picker 显示 upstream `claude-opus-4-8`，并保持 upstream order。
- [ ] Product Claude picker继续显示同一 row，Product Kimi picker不显示。
- [ ] 真实 managed Codex CLI 使用 `claude-opus-4-8` 完成 typed terminal，runtime model未回退。
- [ ] clean config 写 current managed revision；revision 1/missing config 自动迁移且保留 local/custom siblings。
- [ ] 重复 prepare 输出稳定，不复制 provider row。
- [ ] L3 focused Rust/Vitest/typecheck/cargo/runtime contracts/OpenSpec strict通过。
- [ ] Hot Doge 中 Home、Native、Panel/Kanban/Shared 的列表一致，真实发送成功。

## Technical Approach

- Production `Doge APP` 已保存 `claude-*` prefix、Responses endpoint、Anthropic target、raw-model passthrough route；minimal `/v1/responses` probe with `claude-opus-4-8` 已 completed / `OK`。
- Native `compatible_product_api_protocols` 是唯一 protocol evidence owner；只扩 Claude-family fallback。
- Renderer engine-to-protocol mapping不改；现有 single projection自动让 row进入 Codex。
- `ACCOUNT_MANAGED_CONFIGURATION_REVISION` 从 1 bump到2；exact-engine send-time prepare复用现有 transaction/verification/rollback。

## Decision (ADR-lite)

**Context**：route callability已经存在，但旧 client fallback仍把 Claude限制为 Messages。

**Decision**：remote route作为callability authority、Native normalization作为visibility authority、managed revision作为upgrade authority；不增加新 IPC、parallel catalog或local proxy。

**Consequences**：future explicit upstream `api_protocols` 仍可精确收窄；route/runtime failure保持exact target error且不fallback。

## Out of Scope

- local/custom provider compatibility推断。
- 新增本地 protocol proxy。
- 恢复 Engine Management UI或登录期阻塞准备。

## Verification Level

L3 Cross-layer / High-risk：remote route→Native protocol facts→Renderer target catalog→managed config migration→Codex runtime。
