## Context

`useCustomPrompts` 在 workspace `connected` 后以 `idle-prewarm` 调用 `prompts_list`。编排层对 timeout / workspace cancel 使用 `fallback`，当前实现把 fallback 的 `[]` 当作权威结果写入 state，并设置 `lastFetchedWorkspaceId`，导致：

1. `!` 补全（`ChatInputBoxAdapter.promptCompletionProvider`）只读 props.prompts → 永久空态 UI
2. 创建提示词走 on-demand refresh 才恢复，造成「加一条又好了」的用户感知

`useCustomCommands` 已沉淀正确模式：记录 `failedReason`、soft-cancel 保留旧列表、真实失败 toast、不把 cancel 当空成功。

## Goals / Non-Goals

**Goals:**

- Soft-cancel（`stale`/`cancelled`）不污染 prompts 缓存
- 真实失败（`timeout` 等）可重试，不 stamp「已成功拉取」
- 并发 refresh 共享同一 Promise
- 内存为空时打开 `!` 触发一次 on-demand revalidate
- 兼容 app-shell + PromptSection 双 `useCustomPrompts` 实例（事件同步）

**Non-Goals:**

- 文件系统 watcher / 60s 轮询
- 改造 skills 等同构 hook
- 变更 `prompts_list` 返回结构或 scope 语义

## Decisions

### D1. Soft-failure 语义对齐 `useCustomCommands`

- `fallback(reason)` 记录 `failedReason`，返回 `[]` 仅作为 orchestrator 占位
- `reason ∈ {stale, cancelled}`：保留 `prompts` 现状，**不**更新 lastFetched，**不** toast
- 其他 reason（如 `timeout`）：不更新 lastFetched；若当前列表非空则保留；空列表允许后续重试；toast 去重 id=`prompts-list-unavailable`
- 无 failedReason 的成功 settle：`setPrompts(data)`（可为空数组），`lastFetchedWorkspaceId = workspaceId`，清除 error

### D2. lastFetched 仅表示「权威成功 settle」

- 仅在无 `failedReason` 时写入 `lastFetchedWorkspaceId`
- effect 仍跳过「同 workspace 已成功拉取」的重复 prewarm，避免每次 render 打 list
- 失败后 effect 可在依赖变化时再 prewarm；也可由 on-demand / 事件 / `!` revalidate 触发

### D3. inFlight 改为 shared Promise

- `inFlightRef: Promise<void> | null`（或带结果的 Promise）
- 后续 `refreshPrompts` 若已有 in-flight，**await 同一 promise** 而非 `return`
- 保证 create 后的 `await refreshPrompts()` 在 prewarm 未完成时不会误以为已刷新

### D4. `!` 空态 revalidate 走事件 / callback，不直连 IPC

方案对比：

| 选项 | 说明 | 取舍 |
|------|------|------|
| Provider 内 `getPromptsList` | 绕过 hook 缓存 | 双实例分裂 ❌ |
| 透传 `onRefreshPrompts` | Adapter 空时调用 | 清晰但 prop 链路长 |
| `dispatchCustomPromptsChanged(workspaceId)` | 已有多实例订阅 | 零新 API，兼容 ✅ |

**采纳**：空列表时 `dispatchCustomPromptsChanged(workspaceId)`，并可选调用透传的 `onRefreshPrompts?.()` 若存在。优先事件以兼容未透传路径；若透传 refresh 则直接 await 可减少一帧延迟。

实现取最小兼容：

1. Adapter 在 `promptCompletionProvider` 中，当 `prompts.length === 0` 且有 `workspaceId` 时调用 `onRefreshPrompts?.("on-demand")` 或 dispatch 事件
2. 为避免每次空查询都打 IPC：同一次 trigger session 内 debounce / 单飞（依赖 hook 内 shared inFlight）
3. revalidate 期间 UI 仍可先展示 empty + create；刷新完成后下一次 search/query 更新展示（provider 被再次调用时读新 props）

**注意**：provider 是 sync 于 props 的闭包；dispatch 后 state 更新是异步的。因此：

- 首次 `!` 若内存空：触发 refresh，当次仍可能 empty
- refresh 完成后用户再输入或重新触发 search 即可看到（`useCompletionDropdown` 会在 query 变化时 re-search）
- 为改善 UX：provider 可 `await onRefreshPrompts()` 若 callback 返回 Promise 并在 await 后由 adapter 读取「最新 prompts」——但 props 不会在同一次 callback 内更新

更稳妥的最小实现：

- `onRefreshPrompts` 返回 `Promise<CustomPromptOption[] | void>`：hook 的 refresh 在成功后 resolve 当前列表；provider await 后若拿到数组则用该数组渲染，否则退回 props
- 这样当次 `!` 打开也能展示恢复后的列表

**最终 D4**：`refreshPrompts` 改为成功时 resolve 列表（或返回 `CustomPromptOption[]`）；`onRefreshPrompts` 透传到 Adapter；空态时 `await onRefreshPrompts("on-demand")` 用返回值填充当次 dropdown。非空时不强制 revalidate（兼容性能）。

### D5. Toast 与 i18n

- 新增 `chat.promptsListUnavailableTitle` / `Message`（en + zh 至少；其他 locale 可先 en fallback 或复制 commands 模式）
- toast id 固定去重，与 commands 一致

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 空列表 revalidate 增加一次 list IPC | 仅当 `prompts.length===0`；shared inFlight 防抖 |
| soft-cancel 后长时间不刷新 | 用户 `!` 空态 / 创建 / settings 打开仍会 on-demand |
| toast 在启动多任务 timeout 时打扰 | 仅非 soft-cancel 失败；id 去重；无成功列表时更需要可见性 |
| prop 透传漏接 | 事件 fallback：`dispatchCustomPromptsChanged` 仍触发其他实例 |

## Migration Plan

1. 合并前端改动即可，无数据迁移
2. 回滚：还原 hook + Adapter 透传，行为回退到旧空缓存语义

## Open Questions

- 无阻塞项。是否为 prompts 加 watcher 留待后续 change。
