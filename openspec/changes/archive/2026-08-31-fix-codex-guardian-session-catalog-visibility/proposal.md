# Proposal: fix-codex-guardian-session-catalog-visibility

## 背景与问题

`fix-codex-guardian-background-thread-filter`（PR #38）只把 guardian / background 过滤接入了 `list_threads` 的运行时统一路径（`codex/thread_listing.rs` 的 live thread/list + local scan merge）。2026-08-30 的 `712792f47` / PR #54 引入了启动 hydration 的 full-catalog 合并：侧边栏会话列表还会消费 `list_workspace_sessions` 的 workspace session catalog 投影。

该投影层（`session_management_catalog_projection.rs`，lib 与 doge_daemon 通过 `include!` 共享同一份源码）把 codex 磁盘会话映射为 catalog entry 时完全丢弃 `LocalUsageSessionSummary.background_kind`，`auto_session` 恒为 `None`。引擎内部创建的 guardian 线程也没有 `record_hidden_codex_helper_thread` 登记记录，前端 `hiddenAutomaticSessionIds` 与 prompt 前缀兜底（不含 guardian prompt）都拦不住。结果：v0.1.12 起 guardian 会话（标题为 "The following is the Codex agent history..."）经 catalog 路径重新出现在侧边栏。

另外 remote backend 模式下 daemon 的 `list_threads`（`doge_daemon/daemon_state.rs`）live 成功时原样透传 thread/list 响应、local fallback 也不做任何 background 过滤，是同一缺口的另一半。

## 目标

- background 会话（guardian review / 非 thread_spawn subagent helper）在所有会话列表链路统一不可见：
  1. workspace session catalog 投影（本地 + daemon 共享源码）；
  2. daemon remote 模式 `list_threads` 的 live 透传与 local fallback；
  3. 既有 `list_threads` 本地统一路径行为保持不变（PR #38 已覆盖）。
- 分类仍然只依赖结构化 session_meta 字段为主、prompt 前缀为 legacy 兜底；前端零改动。

## 方案概要

1. 把纯分类 helpers（prompt 前缀常量、`is_codex_background_helper_text`、`is_codex_background_helper_session`、`is_codex_background_helper_thread_entry`、`codex_session_identifier_candidates`）从 `codex/thread_listing.rs` 移到 `local_usage.rs`（pub(crate)），两个 crate 都通过 `#[path]`/`include!` 编译该文件，`thread_listing.rs` 改为引用。
2. catalog 投影构造 codex entries 前用 `is_codex_background_helper_session` 过滤。
3. daemon `list_threads`：local fallback 过滤 background sessions；live 透传分支用有界 local preview scan 构造 background id 集合 + entry 文本兜底过滤 data 数组，scan 失败时降级为仅文本过滤并记 debug 日志。
4. 补投影层与 daemon 的定向回归测试。

## 非目标

- 不改 collab `thread_spawn` 子代理展示行为。
- 不新增 guardian prompt 前缀到文本兜底名单（避免误伤 fork_context prompt 同前缀的可见 thread_spawn 会话）。
- 不改前端代码；不改本地 `list_threads` 路径逻辑。

## 风险

- daemon live 分支新增一次有界 local preview scan，增加少量延迟；缓解：复用既有 5s timeout 模式，失败降级文本过滤。
- catalog 过滤后背景会话不再出现在 load-older / radar 等 catalog 消费方——这是预期行为，与 PR #38 的可见性口径一致。

## 验收

- 本机真实 guardian rollout（`~/.codex/sessions/2026/08/30/` 若干）在 catalog 投影输出中不存在。
- daemon `list_threads` local fallback 与 live 透传均不含 background 会话。
- 定向 cargo test 全绿；openspec validate --strict 通过。
