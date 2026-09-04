# Verification: 微信会话生命周期与控制命令易用性

## Scope

Verification level：L3 Cross-layer / High-risk。

最高风险边界是 per-`wxid` route persistence 与 resume decision：`lastActivityAtMs` 必须保持 legacy JSON 可读，1 天 inactivity expiry 与 `/new` 只能清除当前 route，不得删除 native session/history 或改变 selected target。控制命令继续在 engine dispatch 前消费。

## Commands

| Command | Result |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib wechat::`（isolated `CARGO_TARGET_DIR`） | PASS：43 passed，0 failed |
| `cargo check --manifest-path src-tauri/Cargo.toml --lib`（isolated `CARGO_TARGET_DIR`） | PASS；仅 repository baseline warnings |
| `npm run check:runtime-contracts` | PASS：AppShell 与 Git history runtime contracts 均为 OK |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| `npx openspec validate add-wechat-session-control-ux --type change --strict --no-interactive` | PASS |
| `git diff --check` | PASS；仅 working-tree line-ending notices |

## Assertions

- 相同 target 的 route 在 1 天 TTL 内 resume；达到 TTL 后下一条普通消息创建新 native session。
- 缺少 `lastActivityAtMs` 的 legacy route 仍可读取并按未过期处理。
- `/new` 清除 route 与 pending selection，同时保留 selected target；无 target 时返回 `/workspace` 引导。
- `/help`、`/帮助` 与 new-session aliases 在 pending/non-pending 状态下均由 control parser 消费。
- target change、manual reset、expiry 均不删除旧 native session 或 desktop history。
- 每个 `wxid` 的 target、pending state 与 route 继续相互隔离。

## Residual Scope

- 未执行 L4 全量 Rust/JS suite、三平台 package build 或真实微信客户端 smoke；由 PR CI / release 验证承担。
- 未做真实时间等待 24 小时的 manual test；TTL boundary 由 deterministic `now_ms` regression 覆盖。
- 本变更无 frontend、IPC schema、database migration 或 multi-CLI foundation ADR 变更。
