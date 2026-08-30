## Why

Production `Doge APP` 已能把 Claude-family model 经 OpenAI Responses 转换到 Anthropic target，但 Doge 对 metadata-absent Claude rows 仍只声明 `anthropic-messages`，导致 Codex Picker 与 execution validation 看不到这个已可调用能力。需要把 remote callability、client catalog facts 与版本化 managed config migration 合成一个新老用户都无感的闭环。

## 目标与边界

- Product Codex 可以选择并真实调用 upstream Claude-family model。
- 新用户直接获得 current managed provider config；老用户升级后在首次 exact-engine send 前幂等迁移。
- upstream exact route 与真实 Codex typed terminal 是 compatibility authority；Doge 只投影已验证 endpoint facts。
- 保持登录/首页非阻塞、send-time exact-engine provisioning、existing Native binding identity 与 Product target catalog single owner。

## What Changes

- 保留 production `Doge APP` 的 `claude-*` Responses→Anthropic prefix route 与 raw-model passthrough。
- Native 对无 metadata 的 Claude/Anthropic family 输出 `openai-responses + anthropic-messages`。
- 继续由 `projectProductTargetCatalogV1` 一次投影 Composer、Panel/Kanban、Shared、target repair 与 send-time validation。
- bump `ACCOUNT_MANAGED_CONFIGURATION_REVISION`，fresh config直接写current projection，stale same-id managed entry在首次Codex managed send前自动重建并保留local/custom siblings。
- 添加 route、protocol projection、fresh/upgrade convergence 与真实 Codex/Claude-model turn evidence。

## 技术方案对比与取舍

- **采用：upstream route + Native endpoint facts + managedRevision migration**。callability、visibility、upgrade convergence同源，失败可删除route并让client fail closed。
- **拒绝：只改upstream**。旧client仍过滤Claude row，功能不可达。
- **拒绝：只改client**。若route消失会展示不可调用组合。
- **拒绝：Doge内置protocol proxy**。重复上游conversion并扩大secret/stream/tool/recovery风险。

## Capabilities

### New Capabilities

- `product-claude-models-in-codex`: 定义Claude Responses route、Product catalog protocol facts、new/upgrade managed config convergence与真实Codex evidence。

### Modified Capabilities

<!-- none -->

## 验收标准

- Product Codex显示并发送`claude-opus-4-8`，真实Codex CLI typed terminal成功且无model fallback。
- Claude engine仍显示该row，Kimi不显示。
- clean config与revision 1 legacy config均收敛到current revision；repeated prepare稳定且user-owned siblings不变。
- 所有Product target consumers使用同一catalog；route/runtime failure不silent fallback。

## 非目标

- 不为local/custom provider猜测cross-protocol support。
- 不新增本地OpenAI↔Anthropic proxy，不修改CLI native wire protocol。
- 不恢复Engine Management或登录期blocking engine preparation。

## Impact

- Remote：production `Doge APP` Composite route configuration。
- Rust：Product model normalization、managed configuration revision/builders/tests。
- Renderer：compatibility/target/picker/Panel-Kanban focused fixtures；production mapping复用既有owner。
- Docs：OpenSpec、Trellis catalog/account contracts、foundation ADR calibration。
- Verification：L3 focused Rust/Vitest/typecheck/cargo/contracts + real Codex managed turn。
