# Change: 修复 Doge 账号登录 `protocolMismatch`

## Why

macOS 内部试用包在账号密码正确时返回裸 `protocolMismatch`。该 code 表示 Doge 与 token2api 的 authority contract 在某个阶段不一致，但当前交互没有指出失败阶段，也不能证明是服务端 response drift、客户端 projection 还是本地 session commit。登录是账号增强能力的入口，必须 fail closed，同时给用户明确可行动结果。

## What Changes

- 以 production request evidence 锁定 login contract drift 的唯一责任层。
- 修复该责任层并添加 exact response regression test；禁止 access-only 或宽松解析 fallback。
- 保留稳定 machine-readable diagnostic code，同时把用户可见文案收敛为中文行动提示。
- 将 production endpoint contract probe 与最终 DMG 登录 smoke 纳入发布验收。

## Impact

- Affected capability: `account-authority-login-contract`
- Possible code surfaces: `src-tauri/src/account/**`、token2api auth/session handler/service、Account UI failure projection、macOS release artifact
- Security: password/token/API Key 不得进入 logs、diagnostics 或 UI raw details
