# Fix workspace session startup hydration

## Why

修复初始化进入 App 后，非 active 且可见的 workspace 长时间显示 `Loading...`，必须点击 workspace 才出现会话的问题。

## What Changes

在 active workspace 完成 startup gate 后，按 idle 顺序自动为可见、connected 且未折叠的非 active workspace 加载首屏会话列表；继续复用现有 startup orchestrator 的 dedupe、stale、timeout 和 fallback contract。

## 目标与边界

## Context

当前 cold-start 为保护 active workspace 的 first-paint，会跳过非 active workspace。历史优化同时移除了通用 background `full-catalog` prewarm，但 Sidebar 仍将未 hydration 的 connected workspace 渲染为 loading。因此 sibling workspace 没有请求，却显示为永久加载中。

## Requirements

- active workspace 仍优先完成 `first-paint` hydration。
- `startup-gate-ready` 后，对 connected 且未折叠的非 active workspace 按 idle 顺序执行 bounded `first-paint` hydration。
- background hydration 一次只推进一个未完成 workspace，不恢复自动 `full-catalog`，不阻塞用户交互。
- 用户切换 workspace、显式刷新、stale response、失败和 timeout 继续复用现有 dedupe / stale / fallback contract。
- 已 hydration、collapsed、disconnected workspace 不重复发起自动请求。

## Options and Trade-offs

### Option A: gate-ready 后按 idle 顺序执行 bounded `first-paint`（采用）

active workspace 首屏完成后，从 workspace registry 中逐个选择可见目标，通过既有 orchestrator 执行 `first-paint`。优点是会话无需点击即可出现，同时保留 active 优先、单并发和重子源跳过；代价是非 active workspace 会在首屏之后逐个出现。

### Option B: Sidebar 在未 hydration 时直接显示空态

移除非 active workspace 的 `Loading...`，等用户点击后再加载。实现最小，但初始化仍不会显示会话，无法满足用户需要，也会把真实数据缺失伪装成空 workspace，因此不采用。

## Acceptance Criteria

- [ ] 初始化 active workspace 完成 first-paint 后，普通 sibling workspace 会自动显示其首屏会话。
- [ ] 同一时刻不会因该修复启动两个 `thread-session-scan` hydration。
- [ ] active workspace first-paint 前不会启动非 active workspace hydration。
- [ ] 无 active workspace 的 Home 路径保持现有行为。
- [ ] 相关 Vitest、typecheck、target ESLint 通过。

## 非目标

- 不自动加载完整历史；`Load older`、Session Management、force refresh 继续负责 `full-catalog`。
- 不修改 backend catalog、Tauri payload 或 native session scanner。
