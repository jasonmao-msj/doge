# Backend 开发规范（doge / src-tauri）

本目录适用于 `src-tauri/src/**` 的 Rust backend 开发。

## 技术基线（Project Facts）

- Runtime：Tauri 2.x + Tokio
- 并发状态：`tokio::sync::Mutex`（见 `state.rs`）
- command 注册：`command_registry.rs`
- 文件持久化：`storage.rs`（atomic write + lock file）
- 高风险模块：`engine/*`, `codex/*`, `workspaces/*`, `git/*`, `local_usage.rs`

## 规范目录

| 文档 | 用途 |
|---|---|
| [Directory Structure](./directory-structure.md) | Rust 模块落位与拆分规则 |
| [doge Storage and Serialized Compatibility](./doge-storage-and-serialized-compatibility.md) | app-home/bundle/project-local migration、dual-read/new-write namespace 与 privacy contract |
| [Upstream Service and Release Isolation](./upstream-service-isolation.md) | upstream service removal、developer-only sync、credential/updater/release fail-closed contract |
| [Error Handling](./error-handling.md) | `Result` 与错误传播策略 |
| [Logging Guidelines](./logging-guidelines.md) | 日志可观测性与敏感信息约束 |
| [Database Guidelines](./database-guidelines.md) | 文件存储/锁/原子写规范 |
| [Computer Use Bridge](./computer-use-bridge.md) | Computer Use status-only bridge 的 command / platform / status contract |
| [Account Convenience Native Contract](./account-convenience-native-contract.md) | token2api authority、OS vault、safe IPC、Codex recipe/config transaction 与 Local Mode isolation contract |
| [Claude Context Usage Contract](./claude-context-usage-contract.md) | Claude home resolution、runtime `context_window`、post-turn `/context` probe 与 `UsageUpdate` payload contract |
| [Codex Provider-Scoped Runtime Contract](./codex-provider-scoped-runtime.md) | Codex provider profile、provider-scoped `CODEX_HOME`、runtime key、thread binding、fork、stale retry 与 `codex-tui` launch identity contract |
| [Provider-Scoped Model Catalog Contract](./provider-scoped-model-catalog.md) | 五 CLI provider-bound/local validation model lookup、public merge、dedupe、Shared capability propagation、Desktop/daemon parity 与 stale guard contract |
| [Shared Session V2 Execution Target / Send Contract](./shared-session-v2-send-contract.md) | Shared Target、typed ACK、真实 terminal、durable provisioning、Projection 与 owner routing 跨层契约 |
| [Native Provider Continuation Contract](./native-provider-continuation-contract.md) | Native history 只读 materialization、Claude/Codex target ACK、durable recovery、Origin/Family 与 Sidebar 跨层契约 |
| [CLI Version Status Contract](./cli-version-status.md) | login shell noise 隔离、semver comparison 与 latest unknown UI contract |
| [Quality Guidelines](./quality-guidelines.md) | review 门禁与验证命令 |
| [Web Assets Package Contract](./web-assets-package-contract.md) | Web Service ZIP artifact、安装事务、Tauri status 与 daemon asset resolution contract |

## Pre-Development Checklist

- 若任务同时涉及项目规则入口或文档治理边界，先读 `../guides/project-instruction-layering-guide.md`。
- 新增 `#[tauri::command]` 前先核对是否已有近似 command。
- 涉及文件写入时，先阅读 `storage.rs` 的 lock + atomic write 模式。
- 涉及共享状态时，先确认 `AppState` 中锁粒度是否可复用。
- 涉及 payload 结构变更时，同步检查 frontend `src/services/tauri.ts` mapping。
- 涉及 analytics、managed provider default、updater、release signing 或 upstream sync 时，先读 [Upstream Service and Release Isolation](./upstream-service-isolation.md)。
- 涉及 `.doge` path、legacy migration、serialized marker/MIME/env 或 daemon token 时，先读 [doge Storage and Serialized Compatibility](./doge-storage-and-serialized-compatibility.md)。
- 涉及 Web Service frontend assets、Release ZIP、managed install 或 daemon asset candidate 时，先读 [Web Assets Package Contract](./web-assets-package-contract.md)。
- 涉及 Claude usage/context/history 时，先读 [Claude Context Usage Contract](./claude-context-usage-contract.md)。
- 涉及 Codex provider、`CODEX_HOME`、`start_thread` / `fork_thread` / `turn/start`、Codex history/catalog 或 app-server launch identity 时，先读 [Codex Provider-Scoped Runtime Contract](./codex-provider-scoped-runtime.md)。
- 涉及五 CLI provider binding、`get_engine_models`、Shared target validation 或 Composer 模型菜单时，先读 [Provider-Scoped Model Catalog Contract](./provider-scoped-model-catalog.md)。
