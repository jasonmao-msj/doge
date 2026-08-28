# Design: fix-codex-guardian-background-thread-filter

## 结构化信号（事实源：本机 rollout session_meta）

Guardian 会话的 session_meta（`~/.codex/sessions/2026/08/28/rollout-2026-08-28T10-26-00-*.jsonl`）：

```json
{
  "type": "session_meta",
  "payload": {
    "id": "01a04630-...",
    "parent_thread_id": "01a0462f-...",
    "source": { "subagent": { "other": "guardian" } },
    "thread_source": "guardian_review",
    "originator": "Codex Desktop"
  }
}
```

可依赖的稳定信号：

1. `thread_source`（string）：`guardian_review` 为已知 background 值。
2. `source.subagent`（object）：已有 `thread_spawn` 形态表示用户可见的 collab 子代理；其余形态（当前为 `other`）均是非用户发起的 helper。

不依赖的信号：prompt 文本、title/preview 文本（仅作 legacy fallback）。

## 分类规则

在 `local_usage.rs` 新增 `classify_codex_background_helper_from_session_value(value) -> Option<&'static str>`：

- `thread_source` / `threadSource` == `"guardian_review"` → `Some("guardian-review")`
- `source.subagent`（或 `sessionSource.subAgent`）为 object 且不含 `thread_spawn` / `threadSpawn` → `Some("subagent-helper")`
- 否则 `None`

解析位置与 `extract_codex_subagent_metadata_from_session_value` 相同：root / payload / payload.session_meta 三层都要查（codex 不同版本字段落点不同）。

## 数据流

```
session_meta line
  → classify_codex_background_helper_from_session_value  (local_usage.rs)
  → LocalUsageSessionSummary.background_kind: Option<String>  (types.rs)
  → is_codex_background_helper_session                      (thread_listing.rs)
      = background_kind.is_some() || legacy prompt-prefix heuristic
  → collect_codex_background_helper_session_identifiers
      → live entry id 过滤 + local session 过滤（merge_unified_codex_thread_entries）
```

live `thread/list` entry 自身不带结构化 source 时，通过 local scan 产出的 background id 集合完成过滤；local rollout 文件在线程创建时即落盘，daemon/scan 刷新后即可覆盖。

## 兼容

- `background_kind` serde `default + skip_serializing_if = Option::is_none`，旧缓存 JSON 反序列化不受影响。
- `native_title` 存在的 session 不归类 background 的既有 guard 保留在 prompt fallback 路径；结构化分类优先于该 guard（guardian 会话本来就没有 nativeTitle）。
