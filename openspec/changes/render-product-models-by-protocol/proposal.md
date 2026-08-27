# Proposal: 按 API protocol 投影 Product 模型目录

## Why

当前 Product catalog 在 Native 层把上游 `/v1/models` 的每一行直接归成
`compatible_engines`。当上游没有显式 compatibility metadata 时，fallback 会把 GPT
只分给 Codex、Kimi 只分给 Kimi，导致两个都走 OpenAI-compatible API family 的 managed
engine 显示不同模型列表；例如用户无法在 Codex 中选择 `kimi-for-coding`。

Engine 是本地执行 runtime，API protocol 是 managed Provider 接收请求的 wire family，二者
不能混为同一字段。模型可见性应先由上游 catalog 给出的 API protocol compatibility 决定，
再投影到支持该 protocol 的 Product engines。

## What Changes

- Product model wire 接受并规范化上游 `api_protocols` / `supported_protocols` / `protocols`；
  legacy `compatible_engines` 只作为 protocol evidence 兼容读取。
- Native 输出 canonical `api_protocols`，Renderer 按 engine 的 API protocol capability 过滤：
  Codex 与 Kimi 共享 OpenAI-compatible catalog，Claude 消费 Anthropic Messages catalog。
- 缺少 metadata 时保留已知 family fallback，但 fallback 先归一为 API protocol；unknown family
  继续 fail closed，不从本地 presentation metadata 创造 entitlement。
- 更新默认 target repair、Picker/search 与回归测试，明确 Codex 可选择 Kimi family model。

## Scope

- `src-tauri/src/account/**` Product model wire/projection。
- `src/features/account/runtime/**` Product model DTO、protocol mapping 与 target repair。
- Product engine/model picker 的现有 consumer 与 focused fixtures。
- OpenSpec/Trellis executable contract 与 foundation ADR 校准。

不修改 CLI stdout protocol registry、Provider credential、pricing、session binding 或 token2api
服务端配置。

## Verification

选择 `L3 Cross-layer / High-risk`：变更影响 `upstream /v1/models -> Rust projection -> Tauri DTO
-> Renderer catalog -> ExecutionTarget`。运行 Rust focused tests、Product catalog/target/Picker
focused Vitest、`npm run typecheck`、target ESLint、相关 catalog/runtime contract、OpenSpec strict
validation 与 `git diff --check`。L4 全量 suite、Windows/macOS installer 与真实远端模型发送由
CI/review smoke 承担。
