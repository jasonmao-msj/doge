# 修复账号登录协议不匹配

## Goal

修复 Doge macOS 内部试用包在 token-matrix.com 账号密码正确时仍返回 `protocolMismatch` 的问题，并用线上 contract evidence 与最终 DMG 验证形成闭环。

关联 OpenSpec change：`fix-account-login-protocol-mismatch`。

## Requirements

- 精确区分 authority bootstrap、login HTTP response、login projection、vault/session commit 四个阶段。
- 不得通过放宽 schema validation 或回退 access-only session 掩盖服务端 contract drift。
- 用户可见错误必须是可行动中文提示；`protocolMismatch` 仅作为诊断 code，不直接充当主要提示。
- 不记录或输出 email、password、access token、refresh token、API Key 等 secret。
- 修复必须同时覆盖责任层回归测试与 production endpoint contract probe。

## Acceptance Criteria

- [ ] 线上正确账号密码可以在 Doge 完成登录并进入 authenticated state。
- [ ] 错误密码仍稳定映射为 credentials rejected，不被误报为协议异常。
- [ ] malformed/contract-drift response fail closed，并给出明确阶段与安全重试动作。
- [ ] Rust/Go 责任层定点测试通过。
- [ ] 新 macOS DMG 从最终 artifact 启动，登录 E2E 通过且不新增 crash report。

## Technical Notes

- Doge authority origin 固定为 `https://token-matrix.com`。
- 登录前必须通过 `/api/v1/settings/public` 与 `/api/v1/desktop/v1/authority` negotiation。
- 线上日志只使用 request id、status、reason、operation stage，不读取或回显 secret。
