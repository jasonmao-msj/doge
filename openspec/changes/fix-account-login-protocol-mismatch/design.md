# Design: Account authority login contract recovery

## Evidence-first diagnosis

登录链路拆为四个可验证阶段：

1. `authorityNegotiation`：public settings + authority descriptor。
2. `credentialExchange`：`POST /api/v1/auth/login` 的 HTTP/envelope/typed payload。
3. `sessionProjection`：access/refresh/user identity 进入 Doge canonical auth model。
4. `localCommit`：Keychain + SQLite session metadata 原子收口。

只在生产日志与安全 probe 证明责任层后修改。不得让客户端接受缺少 refresh token、user id 或 durable guarantee 的“部分成功”。

## Confirmed root cause

- AWS production access log：`POST /api/v1/auth/login` 在 `2026-08-15T09:27:30+08:00` 返回 HTTP 200。
- PostgreSQL safe metadata：同一秒生成 `user_id=1` 的 active durable `auth_sessions` row。
- Doge SQLite：同一 operation 被记录为 terminal `succeeded`，并保存 active session metadata；证明 Authority、Rust projection、Keychain 与 SQLite 均已成功。
- Renderer validator：`validateSafeLabelForFieldV1("primaryEmailLabel", "a***@token-matrix.com")` 先应用不包含 `@`/`*` 的 generic `SAFE_LABEL_PATTERN_V1`，再进入永远无法挽回的 field-specific check，最终把合法 native success envelope 误判为 `protocolMismatch`。

因此责任层唯一落在 Doge TypeScript SafeLabel validator。token2api 无需代码或生产部署变更。

## Contract

- Known auth failures use stable `reason` and map to an actionable semantic code。
- HTTP 2xx + `code=0` MUST include a complete typed login payload compatible with advertised authority guarantees。
- Unknown fields MAY be ignored only where the frozen schema explicitly allows forward compatibility；missing/invalid invariant fields MUST fail closed。
- Diagnostic evidence contains only stage、HTTP status、safe reason、request correlation id；no credential or token body。
- `primaryEmailLabel` MUST use a field-specific allowlist that accepts bounded masked-email presentation characters while retaining URI/path/secret rejection。

## Validation matrix

| Case | Expected |
|---|---|
| wrong password | `credentialsRejected` |
| correct password + complete token pair | authenticated |
| success envelope missing durable session field | fail closed with staged protocol diagnostic |
| server 5xx/session store unavailable | `serviceUnavailable` + retry |
| Keychain/SQLite commit failure | local-mode remains available + local recovery action |

## Rollout

先运行 production contract probe，再发布新的 internal macOS artifact。旧 artifact 不自动更新；使用相同稳定文件名替换并更新 SHA-256。
