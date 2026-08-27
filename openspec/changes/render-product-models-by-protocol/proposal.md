# Proposal: 按 API protocol 投影 Product 模型目录

## Why

当前 Product catalog 在 Native 层把 Responses 与 Chat Completions 都归成粗粒度
`openai` protocol。上游 `/v1/models` 当前不携带 protocol metadata，无法表达同一模型在
不同 endpoint 上的可调用性。K3 最初在 Codex Responses 返回
`Model is not supported by composite groups`，根因是 production Composite 缺少
Kimi/K3 的 Responses routes；补齐 route 后同一模型可同时经 Responses 与 Chat Completions 调用。

Engine 是本地执行 runtime，API protocol 是 managed Provider 接收请求的 wire family，二者
不能混为同一字段。模型可见性应先由上游 catalog 给出的 API protocol compatibility 决定，
再投影到支持该 protocol 的 Product engines。

## What Changes

- Product model wire 接受并规范化上游 `api_protocols` / `supported_protocols` / `protocols`；
  legacy `compatible_engines` 只作为 protocol evidence 兼容读取。
- Native 输出 endpoint-level canonical `api_protocols`，Renderer 按 engine 的 API protocol
  capability 过滤：Codex=`openai-responses`、Kimi=`openai-chat-completions`、
  Claude=`anthropic-messages`。
- 缺少 metadata 时保留已知 family fallback，但 fallback 先归一为 API protocol；unknown family
  继续 fail closed，不从本地 presentation metadata 创造 entitlement。
- 更新默认 target repair、Picker/search 与回归测试；K3/Kimi 与 GPT family 按已验证的
  Responses + Chat Completions capability 同时显示在 Codex 与 Kimi。

## Scope

- `src-tauri/src/account/**` Product model wire/projection。
- `src/features/account/runtime/**` Product model DTO、protocol mapping 与 target repair。
- Product engine/model picker 的现有 consumer 与 focused fixtures。
- OpenSpec/Trellis executable contract 与 foundation ADR 校准。

不修改 CLI stdout protocol registry、Provider credential、pricing 或 session binding。
production token2api `Doge APP` Composite 已通过管理 UI 补齐 `kimi*` / `k3*` Responses routes，
作为本 change 的 endpoint E2E prerequisite。

## Verification

选择 `L3 Cross-layer / High-risk`：变更影响 `upstream /v1/models -> Rust projection -> Tauri DTO
-> Renderer catalog -> ExecutionTarget`。运行 Rust focused tests、Product catalog/target/Picker
focused Vitest、`npm run typecheck`、target ESLint、相关 catalog/runtime contract、OpenSpec strict
validation 与 `git diff --check`。L4 全量 suite、Windows/macOS installer 与真实远端模型发送由
CI/review smoke 承担。
