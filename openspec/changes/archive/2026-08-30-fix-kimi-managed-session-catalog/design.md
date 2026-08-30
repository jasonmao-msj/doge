# Design: Provider-Aware Kimi History Discovery

## Root resolution

Kimi history 使用一个内部 root descriptor：

```text
KimiHistoryRoot {
  base_dir: PathBuf,
  provider_profile_id: Option<String>,
}
```

Resolver contract：

- `custom_home = Some(path)`：只返回该 path，`provider_profile_id = None`，保持既有 local/custom behavior。
- `custom_home = None`：返回由 `KIMI_CODE_HOME` 或 `~/.kimi-code` 解析出的 default root，再追加 `.doge/kimi-provider-homes/*` 的直接子目录。
- managed directory name 仅作为 provider profile id metadata；workspace membership 仍由 `session_index.jsonl.workDir` 与 workspace path variants 判定。
- root enumeration 顺序稳定、去重；不存在的 provider-home parent 视为空，不阻断 default history。
- parent 存在但无法枚举时返回 contextual error，catalog caller 可以将 Kimi source 标记为 degraded/partial。

## Shared operation path

`list_kimi_sessions`、`find_workspace_index_entry`、`load_kimi_session`、`delete_kimi_session` 全部消费同一个 root resolver。`find` 返回 root + index entry，而不是只返回 entry；delete 据此重写正确 root 的 `session_index.jsonl`。

Summary 增加 optional `providerProfileId`。Frontend Kimi merge 将其投影为 `ThreadSummary.providerProfileId`，但 thread id 仍保持 `kimi:<canonicalSessionId>`，兼容既有 history loader、selection metadata 和 Shared hide identity。

## Catalog integration

Kimi entries created from native history carry provider metadata when available. Existing durable binding metadata remains higher authority for provider name/source/availability. Provider home directory name alone never creates membership and never bypasses `workDir` filtering.

Catalog source status must not report `authoritative_empty` when managed-root enumeration fails. A successful scan across all resolved roots may report engine-scoped authoritative empty.

## Compatibility and security

- Existing callers that pass `EngineConfig.home_dir` continue to scan exactly that home.
- Default local Kimi history remains discoverable even when no managed providers are configured.
- Provider id is read from an already app-owned directory segment; no user-supplied path is constructed from unvalidated input.
- No session data is copied, migrated, or rewritten during discovery.

## Verification matrix

| Case | Expected result |
|------|-----------------|
| default home only | existing list/load/delete behavior unchanged |
| managed home + restart (`custom_home=None`) | session listed with provider metadata and loadable |
| two managed homes | both roots scanned and workspace-filtered independently |
| parent missing | default scan continues; no false provider rows |
| parent enumeration failure | contextual error/partial source, never authoritative empty |
| explicit custom home | only requested root is scanned |
| same session id in two roots | deterministic dedupe/compatibility behavior; no arbitrary cross-root delete |
