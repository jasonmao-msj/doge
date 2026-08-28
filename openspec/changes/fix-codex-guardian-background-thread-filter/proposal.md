# Proposal: fix-codex-guardian-background-thread-filter

## 背景与问题

Codex Desktop 0.150.0-alpha.8 起引入 Guardian 审批评审：用户会话中每次需要审批的工具调用都会 spawn 一个 guardian 评审子线程（session_meta 中 `thread_source: "guardian_review"`、`source.subagent.other: "guardian"`、带顶层 `parent_thread_id`），并作为普通 rollout 落盘到 `~/.codex/sessions/`。

doge 的 codex 会话列表（`src-tauri/src/codex/thread_listing.rs`）目前只通过 prompt 文本前缀匹配（`CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES`）识别后台会话，名单只覆盖 title generation / run metadata / OpenSpec context / Memory Writing Agent 四类。Guardian 评审 prompt 不在名单内，本地解析（`extract_codex_subagent_metadata_from_session_value`）又只认 `source.subagent.thread_spawn` 形态，导致 guardian 会话被当作普通用户会话捞进侧栏。

## 目标

- 非用户主动发起的 codex 会话（guardian review 及未来同类 subagent helper）必须基于 session_meta 的**结构化字段**归类为 background，不再依赖 prompt 文本匹配。
- live `thread/list` 与 local scan 两路合并时，被归类为 background 的 session id 两路都要过滤。
- 保留既有 prompt 前缀匹配作为旧版本会话（无结构化字段）的兜底，不作为主路径。

## 方案概要

1. `local_usage.rs` 解析 session_meta 时新增结构化分类：`thread_source == "guardian_review"` 或 `source.subagent` 存在但无 `thread_spawn`（如 `other` 形态）→ `background_kind = Some(...)`。
2. `LocalUsageSessionSummary` 增加 `background_kind: Option<String>` 字段（serde skip None）。
3. `thread_listing.rs` 的 `is_codex_background_helper_session` 优先判 `background_kind`，再 fallback 到既有 prompt 前缀 heuristic；`collect_codex_background_helper_session_identifiers` 自动覆盖 live entry 的 id 过滤。
4. 补 local_usage 与 thread_listing 的定向测试。

## 非目标

- 不改 collab `thread_spawn` 子代理的现有展示行为（仍在 session tree 中作为子节点）。
- 不改前端展示层；过滤仍在 Rust 侧单一入口完成。
- 不删除既有 prompt 前缀名单（仅降级为 legacy fallback）。

## 风险

- `source.subagent` 未来若出现需要可见的新形态，会被误归类为 background；缓解：归类规则只针对「无 thread_spawn 的 subagent」，thread_spawn 路径行为不变。
- 旧版本 codex 写出的后台会话无结构化字段，仍靠 prompt 兜底，行为与现状一致。

## 验收

- 本机 `~/.codex/sessions/2026/08/28/` 下两个 guardian rollout 不再出现在 doge workspace 会话列表。
- 定向 cargo test 覆盖：guardian session_meta 分类、subagent.other 分类、thread_spawn 不受影响、merge 过滤。
