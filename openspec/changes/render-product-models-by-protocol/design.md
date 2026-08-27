# Design: Product model API protocol projection

## Domain boundary

本 change 新增 Product-managed API protocol 维度；它描述 Doge managed Provider 的请求 wire
family，不等于 `engineIds.json.protocolFamily`（后者描述 CLI process/stdout transport）。

```ts
type ProductModelApiProtocolV1 =
  | "openai-responses"
  | "openai-chat-completions"
  | "anthropic-messages";

type ProductModelViewV1 = {
  id: string;
  displayName: string;
  model: string;
  apiProtocols: readonly ProductModelApiProtocolV1[];
  capabilities: readonly string[];
};
```

Engine capability 是固定本地事实：

| Product engine | Managed Provider API protocol |
|---|---|
| Codex | `openai-responses` |
| Kimi | `openai-chat-completions` |
| Claude | `anthropic-messages` |

模型只有在 row 声明或 fallback evidence 覆盖目标 endpoint protocol 时才可见；同属
OpenAI-compatible family 不构成跨 endpoint compatibility。模型的 runtime id 不因 engine 改写。

## Native normalization precedence

```text
explicit api_protocols / supported_protocols / protocols
  > legacy compatible_engines mapped to API protocol family
  > known model-family fallback mapped to API protocol family
  > unknown family: fail closed
```

Protocol alias allowlist：

- `openai-responses`：`responses`、`openai-responses`、`openai_responses`。
- `openai-chat-completions`：`openai`、`openai-compatible`、`openai_compatible`、
  `chat-completions`、`chat_completions`。
- `anthropic-messages`：`anthropic`、`anthropic-messages`、`anthropic_messages`、
  `messages`、`claude`、`claude-code`。

Explicit protocol metadata 存在时是 authority；无法识别或归一后为空则丢弃该 row，不再用
model name 扩权。Legacy `compatible_engines` 存在时仅转换为 protocol evidence：
`codex` → Responses、`kimi` → Chat Completions、`claude|claude-code` → Anthropic Messages。
缺少两类 metadata 时，GPT/OpenAI 与 Kimi/Moonshot/K3 根据实测进入 Responses + Chat Completions；
Claude/Anthropic 只进入 Anthropic Messages；
Doubao/Ark 依据既有三 endpoint evidence 进入全部三种；unknown family fail closed。

## Live failure evidence (2026-08-27)

- Codex rollout frozen target：catalog id `k3-256k`，`turn_context.model=k3`。
- route 修复前 `POST /v1/responses`：`k3` 与 `k3-256k` 均返回 HTTP 400
  `Model is not supported by composite groups`；token2api source audit 证明 Responses→Kimi
  Chat Completions converter 已存在，失败发生在 Composite route resolution。
- `POST /v1/chat/completions`：`k3`、`k3-256k`、`gpt-5.6-sol` 均返回 HTTP 200。
- 通过 production 管理 UI 为 `Doge APP` 新增 `kimi*` 与 `k3*` → Kimi / Responses routes
  后，`POST /v1/responses` 的 `k3`、`k3-256k`、`kimi-for-coding` 均返回 HTTP 200 且含 output。
- Doge isolated Codex provider home + managed key + `model=k3` 的真实 `codex exec` turn 退出码 0，
  terminal final message 为 `OK`；证明 Codex runtime 不再收到 Composite group rejection。
- 上游 `/v1/models` 的 K3/Kimi rows 当前没有 `api_protocols`、`compatible_engines` 或
  `capabilities`，因此使用 exact endpoint verified fallback；仍不折叠为 broad `openai`。

## Data flow

```text
managed /v1/models row
  -> ProductModelWire (untrusted aliases)
  -> safe_product_models (validated canonical api_protocols)
  -> account_product_v1_models / prepare payload
  -> parseProductModels / parseProductReady
  -> ProductModelViewV1.apiProtocols
  -> engineSupportsProductModelProtocolV1
  -> Picker / target repair / send-time frozen ExecutionTarget
```

`compatible_engines` 不再进入 Renderer DTO，避免 protocol 与 engine 两份可漂移 authority。

## Validation matrix

| Input row | Canonical protocols | Visible engines | Expected |
|---|---|---|---|
| explicit `responses` | `openai-responses` | Codex | 不扩到 Kimi |
| explicit `chat_completions` | `openai-chat-completions` | Kimi | 不扩到 Codex |
| legacy `compatible_engines=[kimi]` | Chat Completions | Kimi | 不凭 legacy engine hint 扩 endpoint |
| explicit `anthropic` | `anthropic-messages` | Claude | 不扩到 OpenAI endpoints |
| explicit all three | three protocols | Codex + Kimi + Claude | 同一 row 多 endpoint 投影 |
| no metadata, K3/Kimi family | Responses + Chat Completions | Codex + Kimi | production 双 endpoint probe 通过 |
| unknown explicit protocol | none | none | fail closed |
| no metadata, unknown family | none | none | fail closed |

## Good / Base / Bad

- Good：Native 只发布 endpoint-level canonical protocol facts，Renderer 复用一个
  engine-to-protocol map。
- Base：legacy upstream engine metadata 被转换为 protocol family，以兼容旧服务端。
- Bad：Renderer 根据 `gpt` / `kimi` / `claude` 字符串再次猜模型列表。
- Bad：把 Responses 与 Chat Completions 都折叠成 `openai`，不保留可独立校准的 endpoint facts。
