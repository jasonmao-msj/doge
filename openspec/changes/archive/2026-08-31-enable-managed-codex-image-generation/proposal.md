## Why

Doge managed Codex 通过 custom API-key provider 连接 `token-matrix.com`。Codex `0.151.0-alpha.7.2` 对 `gpt-5.6-sol/terra/luna` 使用 bundled `use_responses_lite=true`，Responses Lite 不暴露 hosted `image_generation`；token2api 的 hosted bridge 又明确只作用于 non-Lite request。结果是上游实际支持生图、Doge 也具备图片事件渲染，但模型侧始终看不到工具。

生产实测已经排除“只开服务端开关即可”的假设：channel/group/account image policy 全部开启后，原生 Doge turn 仍无 `image_generation_call`。A/B 将当前 Codex bundled catalog 的三个 GPT-5.6 entry 仅改为 `use_responses_lite=false` 后，token2api usage authority 记录 Doge Managed key、`gpt-5.6-luna`、`按次(图片)`、`1张 (2K)`；显式 Responses probe 也返回 completed `image_generation_call` 和非空 image payload。

## 目标与边界

- managed Codex 对 `gpt-5.6-sol/terra/luna` 自动使用 full Responses，使 token2api hosted image bridge 可注入原生生图工具。
- catalog patch 必须来自本次实际启动的 Codex binary，不能在 Doge 硬编码一份易漂移的完整 upstream catalog。
- 新用户首次使用、老用户升级后首次使用都自动生效；登录与首页继续不被 CLI/capability preparation 阻塞。
- local/custom Codex provider、用户全局 `~/.codex`、其他 engine 不受影响。

## What Changes

- 在 managed Codex launch boundary 调用 exact binary 的 `debug models --bundled`，bounded 读取 JSON catalog。
- 保留完整 catalog，只把 exact `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` 的 `use_responses_lite` 写为 `false`。
- 原子写入 isolated managed provider home，并通过 launch-scoped `model_catalog_json` override 交给 Codex app-server。
- binary/catalog probe 失败、catalog shape 无效或目标 entry 缺失时，在任何 Session/Binding/Turn side effect 前 fail closed；不得回退到 Lite 后伪装“工具不可用”。
- 复用既有 `image_generation_call` realtime/history/render path，不新增特殊 UI 或模型文案判断。

## 技术方案对比与取舍

- **采用：exact-binary bundled catalog patch at managed launch**。与当前 Codex version 同源、跨 macOS/Windows、无需维护完整 catalog snapshot，并且不修改用户 provider。
- **拒绝：只开 token2api channel/account bridge**。Lite request 被 bridge contract 主动排除，已经实测失败。
- **拒绝：把完整 models.json 硬编码进 Doge**。会随 Codex binary 升级漂移，并可能覆盖新模型 metadata。
- **拒绝：修改 token2api 注入 Responses Lite**。Lite tool carrier 与 hosted tool contract 不兼容；在网关伪造会扩大 upstream protocol 风险。
- **拒绝：修改 Codex/token2api source fork**。当前可通过受支持的 `model_catalog_json` contract 完成，无需扩大 upstream merge surface。

## Capabilities

### New Capabilities

- `managed-codex-image-generation`: 定义 managed custom-provider Codex 的 exact-binary catalog materialization、non-Lite image tool exposure、fresh/upgrade convergence 与真实图片 evidence。

### Modified Capabilities

<!-- none -->

## 验收标准

- Hot Doge 使用 managed Codex + `gpt-5.6-sol` 或 `gpt-5.6-luna` 请求生图时，产生真实 `image_generation_call`，而不是只返回“工具不可用”或文字“已生成”。
- token2api usage/accounting 记录 `按次(图片)` 且 output payload 非空；Doge 幕布出现同一 user turn 的制作中/完成图片卡。
- 重新打开会话后图片 artifact 仍按既有 history contract 恢复。
- exact managed launch 自动生成 current catalog；重复启动幂等，binary 更新后重新生成。
- catalog materialization 失败时返回可诊断错误，不创建或污染 Session/Binding/Turn。

## 非目标

- 不为 Claude Code/Kimi 增加生图工具。
- 不改变 image model 定价、token2api image policy 或 content moderation。
- 不修改 Codex CLI、token2api source、engine registry、Shared supported set 或 conversation renderer contract。

## Impact

- Rust：managed Codex launch/profile preparation、bounded child-process output、atomic provider-home artifact、focused tests。
- Config：launch-scoped `model_catalog_json`，不改 terminal global config。
- Renderer：复用现有 generated-image path，仅做真实 Hot Doge 回归。
- Docs：OpenSpec、Trellis Codex provider runtime contract、foundation ADR calibration。
- Verification：L3 focused Rust tests + cargo check + OpenSpec strict + real token2api image accounting + Hot Doge visual acceptance。
