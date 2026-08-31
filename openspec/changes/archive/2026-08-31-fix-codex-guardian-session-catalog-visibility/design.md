# Design: fix-codex-guardian-session-catalog-visibility

## 链路全景（修复点标注）

侧边栏会话列表的数据源有三条入口，background 过滤必须全部覆盖：

1. `list_threads` 本地统一路径（`codex/thread_listing.rs::build_unified_codex_thread_page`）
   - PR #38 已修：live entry 按 background id 集合 + 文本兜底过滤，local scan session 按 `is_codex_background_helper_session` 过滤。
2. workspace session catalog 投影（`session_management_catalog_projection.rs::build_workspace_scope_catalog_data`）
   - 本地 Tauri command 与 daemon RPC 共用（`session_management.rs:3844` 通过 `include!` 内联）。
   - **本 change 修复点 A**：codex 磁盘 summary → catalog entry 映射前过滤 background session。
3. daemon remote `list_threads`（`doge_daemon/daemon_state.rs`）
   - **本 change 修复点 B**：local fallback 过滤 + live 透传过滤。

## 决策记录

### D1: helpers 落在 `local_usage.rs` 而不是新建模块

`local_usage.rs` 是唯一被 lib crate 与 doge_daemon bin（`doge_daemon.rs:128` `#[path]`）同时编译、且已持有结构化分类函数（`classify_codex_background_helper_from_session_value`）的模块。新建共享模块需要在两个 crate root 各加一行 mod 声明，收益相同但 diff 更大。移动的是纯函数（不依赖 AppState / tauri），thread_listing.rs 改为 `use crate::local_usage::...`。

### D2: catalog 在投影层过滤而非前端过滤

前端 merge（`useThreadActions.ts` + `useThreadActions.helpers.ts`）对 catalog 会话只有 id hide set 与 prompt 前缀兜底；结构化信号到前端时已被投影层丢弃。在投影层过滤可让所有 catalog 消费方（首屏 hydration、load-older、radar、folder counts）一次性获得一致口径，前端零改动。

### D3: daemon live 透传用「id 集合 + 文本」双保险，而不是改走统一 merge

daemon 没有 AppState，无法直接复用 `build_unified_codex_thread_page`。选择：live 成功分支内做一次有界 local preview scan（与 local fallback 相同的 scan limit 推算 + 5s timeout 模式），构造 background id 集合过滤 data entries；scan 失败降级为仅文本过滤（`is_codex_background_helper_thread_entry`），不阻塞列表返回。nextCursor 原样透传（过滤造成的页大小漂移与本地 merge 路径的既有语义一致）。

### D4: 不把 guardian prompt 加入文本前缀名单

fork_context spawn 的可见 thread_spawn 子代理首条 user message 与 guardian prompt 共享 "The following is the Codex agent history" 前缀，加入会把这类可见会话误杀（`is_codex_background_helper_session` 中 background_kind=None 时会落到文本分支）。guardian 会话自引入起必带 `thread_source=guardian_review`，结构化分类已全覆盖。

## 测试点

- 投影层：含 `background_kind=Some(...)` 的 codex summary 不产生 catalog entry；普通会话不受影响。
- daemon：local fallback 响应 data 不含 background 会话。
- 既有 PR #38 测试（local_usage 分类 + thread_listing merge）保持绿。
