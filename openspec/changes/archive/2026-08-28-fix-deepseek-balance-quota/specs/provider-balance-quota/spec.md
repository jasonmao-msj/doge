## ADDED Requirements

### Requirement: DeepSeek host MUST route to official balance API

系统 MUST 将 base_url 识别为 DeepSeek 供应商额度路由（不限于 coding-plan 百分比 host 白名单），并 MUST 使用官方余额接口查询：

- Host 匹配：base_url 大小写不敏感包含 `api.deepseek.com` 或 `deepseek.com`（含 chat base 后缀如 `/anthropic`、`/v1`）。
- Endpoint MUST 固定为 `GET https://api.deepseek.com/user/balance`，MUST NOT 把 chat base 路径拼到 balance path 上。
- 鉴权 MUST 使用 `Authorization: Bearer <api_key>`。
- 成功响应时 `CodingPlanQuotaSnapshot.source` MUST 为 `deepseek`，`via` MUST 为 `api`（或等价 api 路径标记）。

#### Scenario: Codex managed DeepSeek OpenAI-compatible base

- **WHEN** 当前 engine 为 `codex` 且 managed provider 的 `base_url` 为 `https://api.deepseek.com`（或带 `/v1`）
- **AND** API key 非空
- **THEN** 额度路由 MUST 进入 DeepSeek balance 查询
- **AND** MUST NOT 返回 `unsupported` 或文案 `not a known coding-plan host`

#### Scenario: Claude managed DeepSeek anthropic base

- **WHEN** 当前 engine 为 `claude` 且 provider env `ANTHROPIC_BASE_URL` 为 `https://api.deepseek.com/anthropic`
- **AND** API key 非空
- **THEN** 系统 MUST 仍识别为 DeepSeek
- **AND** HTTP 请求 URL MUST 为 `https://api.deepseek.com/user/balance`

#### Scenario: 空 API key

- **WHEN** base_url 已识别为 DeepSeek
- **AND** api_key 为空
- **THEN** snapshot MUST `success=false`
- **AND** source MUST 表示凭据缺失（如 `empty_credentials`）
- **AND** MUST NOT 发起 HTTP 请求（或等效短路）

### Requirement: Quota snapshot MUST carry balance shape for currency providers

`get_coding_plan_quota` 响应 MUST 在百分比 `windows` 之外，以 additive 字段承载余额型结果：

- `balance.isAvailable: boolean`（映射官方 `is_available`）
- `balance.items[]`：每项至少含 `currency`、`totalBalance`（string）；MAY 含 `grantedBalance`、`toppedUpBalance`
- DeepSeek 成功路径 MUST 填充 `balance`，`windows` MUST 为空数组
- Kimi / MiniMax / 智谱成功路径 MUST 继续只填 `windows`，`balance` MUST 为 null 或省略
- 字段命名在 IPC 上 MUST 使用 camelCase，与既有 snapshot 一致

#### Scenario: 解析官方 balance 成功

- **WHEN** DeepSeek API 返回 200 且 body 含非空 `balance_infos`
- **THEN** snapshot MUST `success=true`
- **AND** `balance.items` 长度 MUST 等于 `balance_infos` 条目数
- **AND** 每项 `currency` / `totalBalance` MUST 与响应一致

#### Scenario: 多币种

- **WHEN** `balance_infos` 同时含 `CNY` 与 `USD`
- **THEN** `balance.items` MUST 保留全部币种
- **AND** MUST NOT 静默丢弃任一 currency

#### Scenario: HTTP 鉴权失败

- **WHEN** balance API 返回 401 或 403
- **THEN** snapshot MUST `success=false`
- **AND** `error` MUST 表明认证失败
- **AND** `balance` MUST 为空或省略

#### Scenario: 百分比供应商不受影响

- **WHEN** base_url 为已知 MiniMax / Kimi / 智谱 coding-plan host
- **THEN** 系统 MUST 仍走既有百分比查询
- **AND** 成功时 MUST 继续返回 `windows`，MUST NOT 要求 `balance` 非空

### Requirement: Balance query MUST serve both Native and Shared quota targets

DeepSeek balance 查询 MUST 通过既有 `get_coding_plan_quota(engine, providerProfileId)` 完成，MUST NOT 新增独立 Tauri command。Native 单 target 与 Shared 多 target 并行查询 MUST 共用同一响应契约。

#### Scenario: Shared 并行 target 含 DeepSeek

- **WHEN** Shared 会话额度列表中存在 engine+DeepSeek profile 与另一 coding-plan profile
- **THEN** DeepSeek target 的 snapshot `source` MUST 为 `deepseek` 且带 `balance`
- **AND** 另一 target MUST 保持自身 `source` / `windows`，MUST NOT 被 DeepSeek 结果覆盖
