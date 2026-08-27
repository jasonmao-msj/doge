# Design: Product model API protocol projection

## Domain boundary

本 change 新增 Product-managed API protocol 维度；它描述 Doge managed Provider 的请求 wire
family，不等于 `engineIds.json.protocolFamily`（后者描述 CLI process/stdout transport）。

```ts
type ProductModelApiProtocolV1 = "openai" | "anthropic";

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
| Codex | `openai` |
| Kimi | `openai` |
| Claude | `anthropic` |

因此相同 catalog snapshot 下 Codex 与 Kimi 的模型行、顺序必须一致。模型的 runtime id 不因
engine 改写；例如 Codex 选择 `kimi-for-coding` 后仍发送该 exact runtime model。

## Native normalization precedence

```text
explicit api_protocols / supported_protocols / protocols
  > legacy compatible_engines mapped to API protocol family
  > known model-family fallback mapped to API protocol family
  > unknown family: fail closed
```

Protocol alias allowlist：

- `openai`：`openai`、`openai-compatible`、`openai_compatible`、`responses`、
  `chat-completions`、`chat_completions`。
- `anthropic`：`anthropic`、`anthropic-messages`、`anthropic_messages`、`messages`、
  `claude`、`claude-code`。

Explicit protocol metadata 存在时是 authority；无法识别或归一后为空则丢弃该 row，不再用
model name 扩权。Legacy `compatible_engines` 存在时仅转换为 protocol evidence：`codex|kimi`
→ `openai`，`claude|claude-code` → `anthropic`。缺少两类 metadata 时，GPT/OpenAI 与
Kimi/Moonshot/K3 → `openai`，Claude/Anthropic → `anthropic`，Doubao/Ark 依据现有已验证
双协议证据 → 两者。

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
| explicit `openai` | `openai` | Codex + Kimi | 两边列表一致 |
| legacy `compatible_engines=[kimi]` | `openai` | Codex + Kimi | Codex 可选 Kimi model |
| explicit `anthropic` | `anthropic` | Claude | 不扩到 OpenAI engines |
| explicit both | both | Codex + Kimi + Claude | 同一 row 多协议投影 |
| unknown explicit protocol | none | none | fail closed |
| no metadata, unknown family | none | none | fail closed |

## Good / Base / Bad

- Good：Native 只发布 canonical protocol facts，Renderer 复用一个 engine-to-protocol map。
- Base：legacy upstream engine metadata 被转换为 protocol family，以兼容旧服务端。
- Bad：Renderer 根据 `gpt` / `kimi` / `claude` 字符串再次猜模型列表。
- Bad：为了让 Codex 显示 Kimi model，在 UI 单独拼接 Kimi rows，造成 target repair 与 Picker
  两套结果。
