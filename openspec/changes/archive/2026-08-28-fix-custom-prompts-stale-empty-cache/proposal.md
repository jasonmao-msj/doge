## Why

Composer `!` 提示词补全只读内存中的 `prompts` 列表。启动阶段 `useCustomPrompts` 经 `startupOrchestrator` 做 `idle-prewarm` 时，timeout / stale / cancel 会走 `fallback: () => []`，并把空结果写入 state 且标记 `lastFetchedWorkspaceId`，导致同一 workspace **永不自动重试**。用户看到「暂无提示词」，磁盘上已有提示词；创建一条后 `refreshPrompts(on-demand)` 强制重拉，旧列表才恢复。需要按 `useCustomCommands` 已验证的 soft-failure 语义修复，并补 `!` 打开时的空列表 revalidate。

## What Changes

- 修正 `useCustomPrompts` 对 orchestrator fallback 的处理：区分 soft-cancel（`stale`/`cancelled`）与真实失败（`timeout` 等）
- soft-cancel / 失败时 **MUST NOT** 用空数组覆盖已有列表，**MUST NOT** 将失败记为「已成功拉取」
- 并发 `refreshPrompts` 改为共享 in-flight Promise，避免静默丢弃后续刷新
- `!` 补全打开且内存列表为空时，触发一次 on-demand revalidate（经既有 `dispatchCustomPromptsChanged` / `refreshPrompts` 路径，兼容多 hook 实例）
- 真实加载失败可展示去重 error toast（与 commands 列表对齐，可选且不刷屏）
- 补充 Vitest 覆盖 soft-cancel / timeout / 创建后刷新 / 空列表 revalidate

**BREAKING**: 无。API、磁盘格式、`prompts_list` 契约不变。

## 目标与边界

**目标**

- 消除「磁盘有提示词但 `!` 永久空」的静默失败
- 与 `useCustomCommands` 的 soft-failure / 保留旧数据语义对齐
- 保持启动 prewarm 性能路径，不引入秒级轮询

**边界**

- 仅前端 catalog 缓存与 `!` 补全数据源；不改 Rust `prompts_*` 命令语义
- 不引入 prompts 文件系统 watcher（后续可单独立项）
- 不改提示词 CRUD UI 与 md frontmatter 格式

## 非目标

- 不为 prompts 增加 60s 兜底轮询（commands 有 watcher 才配轮询；prompts 本次用 revalidate + 失败可重试）
- 不统一改造 skills 等同构 `lastFetched` 模式（out of scope）
- 不改 stub `promptProvider` 默认实现的产品定位（Adapter 已注入真实 provider）

## 技术方案对比（取舍）

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A. 仅修 `useCustomPrompts` soft-failure | 对齐 commands：soft-cancel 保留列表、失败不 stamp lastFetched、共享 inFlight | 改动面小、根因直接 | `!` 打开时若仍空不会主动再拉 | 必要但不充分 |
| B. 仅 `!` 每次打开全量 list | provider 内直接 `getPromptsList` | 下拉永远新鲜 | 绕过 orchestrator、双实例缓存分裂、每键入都可能打 IPC | 否 |
| C. A + 空列表 on-demand revalidate | 修缓存 + `!` 空时 `refreshPrompts`/`dispatch` 一次 | 兼容双实例、边界清晰、无秒级轮询 | 需把 refresh 能力接到 Adapter 或事件 | **采纳** |

## 验收标准

1. 模拟 `fallback("stale")` / `fallback("cancelled")` 时，已有 prompts **不被清空**，且允许后续成功刷新
2. 模拟 `fallback("timeout")` 且此前无成功列表时，**不** 标记 lastFetched 为成功；后续 on-demand / 创建 / 事件 / `!` 空态 revalidate 可恢复
3. 真实空列表（后端返回 `[]` 且无 failedReason）仍显示「暂无提示词」+「创建提示词」
4. 创建 / 更新 / 删除后列表与设置页、`!` 菜单一致
5. 并发两次 `refreshPrompts` 只发起一次 in-flight list，后到者拿到同一结果
6. 相关 Vitest 通过；无破坏现有 PromptSection / create 后双 hook 同步测试

## Capabilities

### New Capabilities

- `composer-prompt-completion`: Composer `!` 提示词补全的列表新鲜度、soft-failure 语义与空态 revalidate 契约

### Modified Capabilities

- （无）现有 main specs 无 prompts `!` 补全 freshness 要求；以新 capability 承载

## Impact

- 代码：`src/features/prompts/hooks/useCustomPrompts.ts`、`.test.tsx`；`ChatInputBoxAdapter` / `Composer` 可能透传 `onRefreshPrompts` 或走 `promptEvents`
- i18n：可选 `chat.promptsListUnavailable*`（对齐 commands）
- 后端 / 存储 / IPC schema：无变更
- 启动编排：仍走 `startupOrchestrator` + `catalog` concurrencyKey
